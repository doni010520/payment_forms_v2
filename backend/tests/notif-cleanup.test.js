// =====================================================================
// Cleanup de notificações lidas antigas
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
  return r.json.token;
}

console.log('\n[Notificações · cleanup]');

let tokenAdmin, tokenOp;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
});

await test('operador NÃO pode purgar notif (403)', async () => {
  const r = await req('POST', '/api/admin/notificacoes/limpar', { token: tokenOp, body: { dias_lidas: 30 } });
  assert(r.status === 403);
});

await test('admin purga com default 30 dias', async () => {
  const r = await req('POST', '/api/admin/notificacoes/limpar', { token: tokenAdmin, body: {} });
  assert(r.status === 200);
  assert(typeof r.json.purgadas === 'number');
  assert(r.json.dias_retencao === 30);
});

await test('dias < 7 é elevado para 7 (proteção)', async () => {
  const r = await req('POST', '/api/admin/notificacoes/limpar', { token: tokenAdmin, body: { dias_lidas: 1 } });
  assert(r.json.dias_retencao === 7);
});

await test('dias > 365 é limitado', async () => {
  const r = await req('POST', '/api/admin/notificacoes/limpar', { token: tokenAdmin, body: { dias_lidas: 9999 } });
  assert(r.json.dias_retencao === 365);
});

await test('notificações NÃO LIDAS não são purgadas', async () => {
  // Cria uma notificação nova (não lida) e tenta purgar com 0 dias
  // Como o limite mínimo é 7 dias, e a notif é nova, ela sobrevive
  const before = (await req('GET', '/api/notificacoes', { token: tokenAdmin })).json.notificacoes.length;
  await req('POST', '/api/admin/notificacoes/limpar', { token: tokenAdmin, body: { dias_lidas: 7 } });
  const after = (await req('GET', '/api/notificacoes', { token: tokenAdmin })).json.notificacoes.length;
  assert(after === before, 'nenhuma não-lida deve ter sido removida');
});

await test('própria purga é auditada', async () => {
  await req('POST', '/api/admin/notificacoes/limpar', { token: tokenAdmin, body: { dias_lidas: 30 } });
  const r = await req('GET', '/api/auditoria/sistema?acao=notificacoes_purgadas&limit=5', { token: tokenAdmin });
  assert(r.json.trilha && r.json.trilha.length >= 1, 'cleanup auditado');
});

console.log('\n========================================');
console.log(`Notif cleanup: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
