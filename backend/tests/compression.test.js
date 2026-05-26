// =====================================================================
// Gzip compression nas responses
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[Gzip compression]');

await test('OpenAPI spec (>1KB) é comprimido quando aceita gzip', async () => {
  const r = await fetch(`${BASE}/api/openapi.json`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert(r.status === 200);
  // fetch do node descomprime automaticamente, mas o header indica o que veio
  assert(r.headers.get('content-encoding') === 'gzip', 'header content-encoding: ' + r.headers.get('content-encoding'));
});

await test('Resposta pequena (<1KB) NÃO é comprimida (overhead)', async () => {
  const r = await fetch(`${BASE}/api/health/live`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert(r.status === 200);
  assert(r.headers.get('content-encoding') !== 'gzip', 'health/live é pequeno demais p/ comprimir');
});

await test('Sem Accept-Encoding: gzip, retorna sem compressão', async () => {
  const r = await fetch(`${BASE}/api/openapi.json`, { headers: { 'Accept-Encoding': 'identity' } });
  assert(r.status === 200);
  assert(r.headers.get('content-encoding') !== 'gzip');
});

await test('Header X-No-Compression desabilita (debug)', async () => {
  const r = await fetch(`${BASE}/api/openapi.json`, { headers: { 'Accept-Encoding': 'gzip', 'X-No-Compression': '1' } });
  assert(r.headers.get('content-encoding') !== 'gzip', 'bypass funciona');
});

await test('HTML estático grande é comprimido', async () => {
  const r = await fetch(`${BASE}/app/painel.html`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert(r.status === 200);
  assert(r.headers.get('content-encoding') === 'gzip', 'painel.html (>1KB) deve comprimir');
});

console.log('\n========================================');
console.log(`Compression: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
