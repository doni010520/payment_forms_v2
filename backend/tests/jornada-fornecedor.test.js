// =====================================================================
// V214/Fase 3A: validação dos fixes da jornada fornecedor (F1.5, F2.1, F3.1)
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
async function login(email, senha='senha123') {
  const r = await req('POST', '/api/auth/login', { body: { email, senha } });
  return r.json?.token;
}

console.log('\n[Jornada fornecedor (V214)]');

let fornTok, opTok, admTok;
await test('logins', async () => {
  fornTok = await login('contato@empresahosp.com.br');
  opTok = await login('carlos.souza@fesfsus.ba.gov.br');
  admTok = await login('maria.andrade@fesfsus.ba.gov.br');
  assert(fornTok && opTok && admTok);
});

// F1.5: /api/me/unidades respeita escopo
await test('F1.5: GET /me/unidades para fornecedor retorna SO unidades vinculadas', async () => {
  const r = await req('GET', '/api/me/unidades', { token: fornTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.unidades));
  // contato@empresahosp atende HECC + outras (seed); deve ser < total de unidades
  const total = (await req('GET', '/api/unidades')).json.unidades.length;
  assert(r.json.unidades.length < total, `fornecedor ve ${r.json.unidades.length} de ${total} unidades (esperado escopo)`);
});

await test('F1.5: GET /me/unidades para operador retorna so unidade primaria + extras', async () => {
  const r = await req('GET', '/api/me/unidades', { token: opTok });
  assert(r.status === 200);
  // operador HECC sem extras → 1 unidade
  assert(r.json.unidades.length === 1, `operador ve ${r.json.unidades.length} unidades`);
  assert(r.json.unidades[0].sigla === 'HECC');
});

await test('F1.5: GET /me/unidades para admin retorna todas as ativas', async () => {
  const r = await req('GET', '/api/me/unidades', { token: admTok });
  assert(r.status === 200);
  assert(r.json.unidades.length >= 5, `admin deveria ver muitas, viu ${r.json.unidades.length}`);
});

await test('F1.5: GET /me/unidades sem auth retorna 401', async () => {
  const r = await req('GET', '/api/me/unidades');
  assert(r.status === 401);
});

// F2.1: portal.html lê ?envio=
await test('F2.1: portal.html agora processa ?envio=', async () => {
  const r = await fetch(`${BASE}/app/portal.html`);
  const text = await r.text();
  assert(/envioParam/.test(text), 'envioParam ausente');
  assert(/searchParams.*'envio'/.test(text) || /get\('envio'\)/.test(text), 'leitura de ?envio= ausente');
});

// F2.1: painel.html também lê ?envio=
await test('F2.1: painel.html agora processa ?envio=', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const text = await r.text();
  assert(/envioParam/.test(text), 'envioParam ausente no painel');
  assert(/verDetalhes\(envioParam\)/.test(text), 'verDetalhes nao chamada com envioParam');
});

// F3.1: comentários geram notif com tipo "novo_comentario" (em vez de "sistema")
await test('F3.1: comentar gera notificacao com tipo novo_comentario', async () => {
  // Pega um envio do fornecedor
  const lista = (await req('GET', '/api/envios', { token: fornTok })).json.envios;
  if (!lista || lista.length === 0) {
    // cria um
    const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
    const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
    const r = await req('POST', '/api/envios/portal', { token: fornTok,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-03', valor_centavos: 100, numero_nf: 'F3-' + Date.now() } });
    lista.push(r.json.envio);
  }
  const env = lista[0];
  // operador comenta → fornecedor recebe notif tipo novo_comentario
  await req('POST', `/api/envios/${env.id}/comentarios`, { token: opTok, body: { texto: 'teste V214 F3.1' } });
  const r = await req('GET', '/api/notificacoes', { token: fornTok });
  const comentNotif = r.json.notificacoes.find(n => n.tipo === 'novo_comentario');
  assert(comentNotif, 'notif tipo novo_comentario ausente. tipos vistos: ' + r.json.notificacoes.slice(0,5).map(n => n.tipo).join(','));
});

// Prefs de notificação V192 agora consegue filtrar comentários
await test('F3.1: pref V192 comentarios=false agora bloqueia notif de comentario', async () => {
  // Desliga comentarios do fornecedor
  await req('PUT', '/api/me/notif-prefs', { token: fornTok, body: { prefs: { novo_envio: true, status_envio: true, comentarios: false, pagamento: true } } });
  const lista = (await req('GET', '/api/envios', { token: fornTok })).json.envios;
  const env = lista[0];
  // Conta notifs antes
  const antes = (await req('GET', '/api/notificacoes', { token: fornTok })).json.notificacoes.filter(n => n.tipo === 'novo_comentario').length;
  // Operador comenta
  await req('POST', `/api/envios/${env.id}/comentarios`, { token: opTok, body: { texto: 'comentario que deveria ser bloqueado V214' } });
  const depois = (await req('GET', '/api/notificacoes', { token: fornTok })).json.notificacoes.filter(n => n.tipo === 'novo_comentario').length;
  assert(depois === antes, `esperava nao receber (pref off), antes=${antes} depois=${depois}`);
  // Restaura
  await req('PUT', '/api/me/notif-prefs', { token: fornTok, body: { prefs: { novo_envio: true, status_envio: true, comentarios: true, pagamento: true } } });
});

console.log('\n========================================');
console.log(`Jornada-fornecedor: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
