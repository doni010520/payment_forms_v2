// =====================================================================
// CORS — allowlist configurável, preflight, expose-headers, wildcards
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[CORS allowlist]');

await test('preflight OPTIONS retorna 204', async () => {
  const r = await fetch(`${BASE}/api/health`, { method: 'OPTIONS',
    headers: { Origin: 'https://app.exemplo.com', 'Access-Control-Request-Method': 'GET' } });
  assert(r.status === 204, `esperava 204, veio ${r.status}`);
});

await test('Access-Control-Allow-Methods inclui PATCH e DELETE', async () => {
  const r = await fetch(`${BASE}/api/health`, { method: 'OPTIONS',
    headers: { Origin: 'https://app.exemplo.com', 'Access-Control-Request-Method': 'PATCH' } });
  const m = r.headers.get('Access-Control-Allow-Methods') || '';
  assert(m.includes('PATCH') && m.includes('DELETE'), `methods="${m}"`);
});

await test('Access-Control-Allow-Headers inclui Idempotency-Key', async () => {
  const r = await fetch(`${BASE}/api/health`, { method: 'OPTIONS',
    headers: { Origin: 'https://app.exemplo.com', 'Access-Control-Request-Headers': 'Idempotency-Key' } });
  const h = r.headers.get('Access-Control-Allow-Headers') || '';
  assert(h.includes('Idempotency-Key'), `headers="${h}"`);
  assert(h.includes('Authorization'));
});

await test('Access-Control-Expose-Headers inclui X-Request-Id', async () => {
  const r = await fetch(`${BASE}/api/health`, { headers: { Origin: 'https://app.exemplo.com' } });
  const exp = r.headers.get('Access-Control-Expose-Headers') || '';
  assert(exp.includes('X-Request-Id'), `expose="${exp}"`);
});

await test('Access-Control-Max-Age presente (preflight cache)', async () => {
  const r = await fetch(`${BASE}/api/health`, { method: 'OPTIONS',
    headers: { Origin: 'https://app.exemplo.com' } });
  const ma = r.headers.get('Access-Control-Max-Age');
  assert(ma && parseInt(ma) > 0, `max-age="${ma}"`);
});

await test('CORS default (wildcard) retorna * em Allow-Origin', async () => {
  // Servidor de teste roda sem CORS_ALLOWED_ORIGINS → default '*'
  const r = await fetch(`${BASE}/api/health`, { headers: { Origin: 'https://qualquer.com' } });
  const ao = r.headers.get('Access-Control-Allow-Origin');
  assert(ao === '*', `allow-origin="${ao}"`);
});

await test('requisição sem header Origin não quebra', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert(r.status === 200);
});

console.log('\n========================================');
console.log(`CORS: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
