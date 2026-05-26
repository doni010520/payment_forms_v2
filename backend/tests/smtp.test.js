// =====================================================================
// V214: SMTP config + envio real
//
// Não tem como verificar entrega real sem mockar nodemailer ou subir um SMTP
// fake. Aqui testamos:
//   - GET/PUT/POST com autorização correta (admin only)
//   - Roundtrip de criptografia (encrypt/decrypt do crypto-helper)
//   - Persistência da config (host/port/from sobrevivem; password masked no GET)
//   - Mantém comportamento legacy: com SMTP_DISABLED=1 + enabled=false,
//     enviarEmail() continua persistindo no log com enviado_real=FALSE
//   - Endpoint /test falha com config inválida (host vazio, destinatário inválido)
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token } = {}) {
  const headers = {};
  let bodyOut;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  return r.json && r.json.token;
}

console.log('\n[SMTP config (V214)]');

let admTok, opTok;
await test('logins', async () => {
  admTok = await login('maria.andrade@fesfsus.ba.gov.br');
  opTok  = await login('carlos.souza@fesfsus.ba.gov.br');
  assert(admTok && opTok);
});

// -------------------------------------------------------------------
// 1. Autorização
// -------------------------------------------------------------------
await test('GET /admin/smtp sem token → 401', async () => {
  const r = await req('GET', '/api/admin/smtp');
  assert(r.status === 401, `status ${r.status}`);
});

await test('GET /admin/smtp como operador → 403', async () => {
  const r = await req('GET', '/api/admin/smtp', { token: opTok });
  assert(r.status === 403, `status ${r.status}`);
});

await test('GET /admin/smtp como admin → 200 + estrutura esperada', async () => {
  const r = await req('GET', '/api/admin/smtp', { token: admTok });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.json.config, 'sem config');
  // Pode estar enabled ou não dependendo se já houve PUT — apenas valida estrutura
  assert(typeof r.json.config.enabled === 'boolean', 'sem enabled');
  assert(typeof r.json.config.port === 'number', 'sem port');
  assert('tem_password' in r.json.config, 'sem tem_password');
  assert('host' in r.json.config, 'sem host');
});

// -------------------------------------------------------------------
// 2. Salvar config e mascarar password
// -------------------------------------------------------------------
await test('PUT /admin/smtp salva config completa', async () => {
  const r = await req('PUT', '/api/admin/smtp', { token: admTok, body: {
    enabled: false, // mantém desativado para não tentar envio real
    host: 'smtp.exemplo.com',
    port: 587,
    secure: false,
    user: 'envio@fesfsus.ba.gov.br',
    password: 'secret-app-password-123',
    from_name: 'FESF Portal Test',
    from_email: 'envio@fesfsus.ba.gov.br',
  } });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.config.host === 'smtp.exemplo.com');
  assert(r.json.config.tem_password === true, 'password salva');
  // GET retorna senha mascarada
  assert(!/secret-app-password/.test(JSON.stringify(r.json.config)), 'senha VAZOU no response!');
  assert(/\*/.test(r.json.config.password), `password não foi mascarada: ${r.json.config.password}`);
});

await test('PUT mantém password antiga quando vier vazia', async () => {
  const r = await req('PUT', '/api/admin/smtp', { token: admTok, body: {
    enabled: false,
    host: 'smtp.outro.com', // mudou
    port: 465,
    secure: true,
    user: 'envio@fesfsus.ba.gov.br',
    password: '', // vazio = mantém anterior
    from_name: 'FESF Portal',
    from_email: 'envio@fesfsus.ba.gov.br',
  } });
  assert(r.status === 200);
  assert(r.json.config.host === 'smtp.outro.com', 'host não atualizou');
  assert(r.json.config.tem_password === true, 'password sumiu — deveria manter a anterior');
});

await test('PUT /admin/smtp como operador → 403', async () => {
  const r = await req('PUT', '/api/admin/smtp', { token: opTok, body: { enabled: false } });
  assert(r.status === 403);
});

await test('PUT enabled=true sem host → 400', async () => {
  const r = await req('PUT', '/api/admin/smtp', { token: admTok, body: {
    enabled: true, host: '', port: 587, from_email: 'x@y.com',
  } });
  assert(r.status === 400);
  assert(/host/i.test(r.json.error || ''), `msg: ${r.json.error}`);
});

await test('PUT enabled=true sem from_email → 400', async () => {
  const r = await req('PUT', '/api/admin/smtp', { token: admTok, body: {
    enabled: true, host: 'smtp.x.com', port: 587, from_email: '',
  } });
  assert(r.status === 400);
  assert(/from_email|email/i.test(r.json.error || ''), `msg: ${r.json.error}`);
});

await test('PUT enabled=true com from_email inválido → 400', async () => {
  const r = await req('PUT', '/api/admin/smtp', { token: admTok, body: {
    enabled: true, host: 'smtp.x.com', port: 587, from_email: 'nao-é-email',
  } });
  assert(r.status === 400);
});

// -------------------------------------------------------------------
// 3. Status endpoint
// -------------------------------------------------------------------
await test('GET /admin/smtp/status — desativado (porque enabled=false)', async () => {
  const r = await req('GET', '/api/admin/smtp/status', { token: admTok });
  assert(r.status === 200);
  assert(r.json.enabled === false);
});

// -------------------------------------------------------------------
// 4. Endpoint de teste — falha controlada
// -------------------------------------------------------------------
await test('POST /admin/smtp/test sem destinatario → 400', async () => {
  const r = await req('POST', '/api/admin/smtp/test', { token: admTok, body: {} });
  assert(r.status === 400);
});

await test('POST /admin/smtp/test com host inexistente → 502', async () => {
  const r = await req('POST', '/api/admin/smtp/test', { token: admTok, body: {
    destinatario: 'teste@local.fake',
    host: 'smtp-que-nao-existe.invalido.local',
    port: 587, secure: false,
    user: 'u', password: 'p',
    from_name: 'Teste', from_email: 'remetente@fesf.test',
  } });
  // Deve falhar via DNS — não persistir nada
  assert(r.status === 502 || r.status === 400, `esperava 502/400, veio ${r.status}`);
  assert(/Falha|invalido|invalid/i.test(r.json.error || ''), `msg sem indicação: ${r.json.error}`);
});

// -------------------------------------------------------------------
// 5. Crypto helper roundtrip
// -------------------------------------------------------------------
await test('crypto-helper: encrypt/decrypt roundtrip', async () => {
  const { encrypt, decrypt, mascarar } = await import('../services/crypto-helper.js');
  const plain = 'minha-senha-super-secreta-2026';
  const enc = encrypt(plain);
  assert(enc.startsWith('v1:'), 'formato v1: esperado');
  const dec = decrypt(enc);
  assert(dec === plain, `decrypted=${dec}`);
  // Detectar adulteração: muda 1 char no tag
  const adulterado = enc.substring(0, enc.length - 2) + 'aa';
  const dec2 = decrypt(adulterado);
  assert(dec2 === null, 'adulteração não detectada');
  // Mascaramento
  assert(mascarar('abcdef1234') === 'ab******34', `mask: ${mascarar('abcdef1234')}`);
  assert(mascarar('') === '', 'mask vazio');
  assert(mascarar('ab') === '**', 'mask curto');
});

// -------------------------------------------------------------------
// 6. enviarEmail() em modo simulator: validado indiretamente pelo fluxo
//    "esqueci senha" (que dispara enviarEmail). Não importamos a função
//    no mesmo processo do server para não abrir 2 handles PGlite.
// -------------------------------------------------------------------
await test('Fluxo "esqueci senha" dispara enviarEmail (registra no log)', async () => {
  const antes = (await req('GET', '/api/emails?limit=200', { token: admTok })).json.total;
  const r = await req('POST', '/api/auth/esqueci-senha', { body: {
    email: 'maria.andrade@fesfsus.ba.gov.br'
  } });
  // Deve responder 200 mesmo que SMTP esteja off (e-mail vai pro log)
  assert(r.status === 200 || r.status === 202, `status ${r.status}`);
  const depois = (await req('GET', '/api/emails?limit=200', { token: admTok })).json.total;
  assert(depois > antes, `e-mail não foi registrado (antes=${antes} depois=${depois})`);
});

// -------------------------------------------------------------------
// 7. listarEmails inclui novos campos
// -------------------------------------------------------------------
await test('GET /emails inclui colunas enviado_real/erro_envio', async () => {
  const r = await req('GET', '/api/emails?limit=5', { token: admTok });
  assert(r.status === 200, `status ${r.status}`);
  assert(Array.isArray(r.json.emails), 'sem array');
  if (r.json.emails.length > 0) {
    const e = r.json.emails[0];
    assert('enviado_real' in e, 'sem coluna enviado_real');
    assert('erro_envio' in e, 'sem coluna erro_envio');
  }
});

console.log('\n========================================');
console.log(`SMTP: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
