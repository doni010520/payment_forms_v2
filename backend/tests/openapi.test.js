// =====================================================================
// OpenAPI spec + visualizador
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[OpenAPI spec]');

await test('GET /api/openapi.json retorna spec OpenAPI 3', async () => {
  const r = await fetch(`${BASE}/api/openapi.json`);
  assert(r.status === 200);
  const j = await r.json();
  assert(j.openapi && j.openapi.startsWith('3.'));
  assert(j.info && j.info.title.includes('FESF'));
  assert(j.paths);
  assert(Object.keys(j.paths).length >= 30, 'tem ao menos 30 paths');
});

await test('Spec documenta os 3 cenários como tags distintas', async () => {
  const r = await fetch(`${BASE}/api/openapi.json`);
  const j = await r.json();
  const tags = j.tags.map(t => t.name);
  assert(tags.some(t => t.includes('Cenário 1')), 'cenário 1 documentado');
  assert(tags.some(t => t.includes('Cenário 2')), 'cenário 2 documentado');
  assert(tags.some(t => t.includes('Cenário 3')), 'cenário 3 documentado');
});

await test('Spec inclui endpoints críticos', async () => {
  const r = await fetch(`${BASE}/api/openapi.json`);
  const j = await r.json();
  assert(j.paths['/api/envios/portal'], 'portal');
  assert(j.paths['/api/envios/publico/{token}'], 'link público');
  assert(j.paths['/api/envios/manual'], 'manual');
  assert(j.paths['/api/expectativas'], 'expectativas');
  assert(j.paths['/api/admin/backup'], 'backup');
  assert(j.paths['/api/admin/restore'], 'restore');
  assert(j.paths['/api/health/detailed'], 'health');
});

await test('Spec define BearerAuth scheme', async () => {
  const r = await fetch(`${BASE}/api/openapi.json`);
  const j = await r.json();
  assert(j.components && j.components.securitySchemes && j.components.securitySchemes.BearerAuth);
});

await test('Página admin-api.html serve 200', async () => {
  const r = await fetch(`${BASE}/app/admin-api.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('openapi.json'));
  assert(t.includes('OpenAPI'));
});

await test('Link "API" no nav admin', async () => {
  const r = await fetch(`${BASE}/app/admin.html`);
  const t = await r.text();
  assert(t.includes('admin-api.html'));
});

console.log('\n========================================');
console.log(`OpenAPI: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
