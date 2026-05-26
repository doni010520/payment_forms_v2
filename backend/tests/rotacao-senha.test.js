// =====================================================================
// Rotacao de sessoes em troca/reset de senha
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
async function loginGet(email, senha = 'senha123') {
  const r = await req('POST', '/api/auth/login', { body: { email, senha } });
  return { token: r.json.token, status: r.status, json: r.json };
}

console.log('\n[Rotacao de sessao em senha]');

// Operador isolado para nao quebrar outros testes (admin/maria fica intocado)
const opEmail = 'carlos.souza@fesfsus.ba.gov.br';
let tokenAntigo, admin;

await test('login operador (token antigo)', async () => {
  const r = await loginGet(opEmail);
  assert(r.token, 'sem token');
  tokenAntigo = r.token;
});

await test('login admin', async () => {
  const r = await loginGet('maria.andrade@fesfsus.ba.gov.br');
  admin = r.token;
});

await test('token antigo valido antes da troca', async () => {
  const r = await req('GET', '/api/me', { token: tokenAntigo });
  assert(r.status === 200);
});

let novoToken;
await test('POST /me/senha rotaciona e retorna novo_token', async () => {
  const r = await req('POST', '/api/me/senha', { token: tokenAntigo,
    body: { senha_atual: 'senha123', nova_senha: 'novaSenhaXYZ' } });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.ok === true);
  assert(typeof r.json.novo_token === 'string' && r.json.novo_token.length > 50,
    `novo_token ausente ou curto: ${r.json.novo_token}`);
  novoToken = r.json.novo_token;
});

await test('token antigo agora invalido (SESSION_REVOKED)', async () => {
  const r = await req('GET', '/api/me', { token: tokenAntigo });
  assert(r.status === 401);
  assert(r.json.code === 'SESSION_REVOKED' || r.json.error === 'Sessao revogada',
    `body=${JSON.stringify(r.json)}`);
});

await test('novo_token funciona imediatamente (sem precisar relogar)', async () => {
  const r = await req('GET', '/api/me', { token: novoToken });
  assert(r.status === 200, `novo_token deveria funcionar, veio ${r.status} ${r.text}`);
});

await test('login com senha antiga falha', async () => {
  const r = await req('POST', '/api/auth/login', { body: { email: opEmail, senha: 'senha123' } });
  assert(r.status === 401);
});

await test('login com senha nova funciona', async () => {
  const r = await req('POST', '/api/auth/login', { body: { email: opEmail, senha: 'novaSenhaXYZ' } });
  assert(r.status === 200);
  assert(r.json.token);
});

// Restaura senha antiga via reset por admin (que tambem revoga sessao)
let senhaPosReset;
await test('admin reseta senha do operador via /usuarios/:id/resetar-senha', async () => {
  // Pega id do operador
  const me = await req('GET', '/api/me', { token: novoToken });
  const opId = me.json.usuario.id;
  const r = await req('POST', `/api/usuarios/${opId}/resetar-senha`, { token: admin,
    body: { nova_senha: 'senhaResetada1' } });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.senha_temporaria === 'senhaResetada1');
  senhaPosReset = r.json.senha_temporaria;
});

await test('reset por admin tambem invalida sessao atual do operador', async () => {
  const r = await req('GET', '/api/me', { token: novoToken });
  assert(r.status === 401, `esperava 401 apos reset por admin, veio ${r.status}`);
});

await test('operador faz login com senha resetada e funciona', async () => {
  const r = await req('POST', '/api/auth/login', { body: { email: opEmail, senha: senhaPosReset } });
  assert(r.status === 200);
});

await test('senha curta (<6) rejeitada com 400', async () => {
  const lg = await loginGet(opEmail, senhaPosReset);
  assert(lg.token, `login falhou: ${JSON.stringify(lg.json)}`);
  const r = await req('POST', '/api/me/senha', { token: lg.token,
    body: { senha_atual: senhaPosReset, nova_senha: 'curta' } });
  assert(r.status === 400, `esperava 400, veio ${r.status} ${r.text}`);
});

await test('senha atual errada rejeitada com 401', async () => {
  const t = (await loginGet(opEmail, senhaPosReset)).token;
  const r = await req('POST', '/api/me/senha', { token: t,
    body: { senha_atual: 'errada', nova_senha: 'novaQualquer123' } });
  assert(r.status === 401);
});

// CLEANUP: restaurar senha123 do operador para nao quebrar outros testes
// que dependem do seed (carlos.souza eh usado por http, e2e, etc).
await test('cleanup: admin restaura senha original do operador', async () => {
  const me = await req('GET', '/api/me', { token: novoToken });
  // novoToken provavelmente foi revogado; pegar id via login fresco
  const opLogin = await loginGet(opEmail, senhaPosReset);
  const meOp = await req('GET', '/api/me', { token: opLogin.token });
  const opId = meOp.json.usuario.id;
  const r = await req('POST', `/api/usuarios/${opId}/resetar-senha`, { token: admin,
    body: { nova_senha: 'senha123' } });
  assert(r.status === 200, `cleanup falhou: ${r.text}`);
});

console.log('\n========================================');
console.log(`Rotacao-senha: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
