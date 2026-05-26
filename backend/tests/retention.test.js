// =====================================================================
// Audit retention — purga de eventos antigos
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

console.log('\n[Audit retention]');

let tokenAdmin, tokenOp;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
});

await test('operador NÃO pode purgar (403)', async () => {
  const r = await req('POST', '/api/admin/auditoria/limpar', { token: tokenOp, body: { dias: 365 } });
  assert(r.status === 403);
});

await test('admin purga com default 365 dias (nada hoje)', async () => {
  const r = await req('POST', '/api/admin/auditoria/limpar', { token: tokenAdmin, body: {} });
  assert(r.status === 200);
  assert(typeof r.json.purgados === 'number');
  assert(r.json.dias_retencao === 365);
  assert(Array.isArray(r.json.acoes_preservadas));
  assert(r.json.acoes_preservadas.includes('aprovado'));
  assert(r.json.acoes_preservadas.includes('marcado_pago'));
});

await test('dias < 90 é elevado para 90 (mínimo legal)', async () => {
  const r = await req('POST', '/api/admin/auditoria/limpar', { token: tokenAdmin, body: { dias: 10 } });
  assert(r.status === 200);
  assert(r.json.dias_retencao === 90, 'forçado para 90, não 10');
});

await test('dias > 3650 (10 anos) é limitado', async () => {
  const r = await req('POST', '/api/admin/auditoria/limpar', { token: tokenAdmin, body: { dias: 99999 } });
  assert(r.status === 200);
  assert(r.json.dias_retencao === 3650);
});

await test('própria purga é registrada na auditoria', async () => {
  await req('POST', '/api/admin/auditoria/limpar', { token: tokenAdmin, body: { dias: 365 } });
  const r = await req('GET', '/api/auditoria/sistema?acao=auditoria_purgada&limit=5', { token: tokenAdmin });
  assert(r.json.trilha && r.json.trilha.length >= 1, 'própria purga auditada');
});

console.log('\n========================================');
console.log(`Retention: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
