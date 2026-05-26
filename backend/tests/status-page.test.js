// =====================================================================
// admin-status.html — dashboard visual de saúde
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[admin-status.html]');

await test('Página existe e serve 200', async () => {
  const r = await fetch(`${BASE}/app/admin-status.html`);
  assert(r.status === 200);
});

await test('Página chama /api/health/detailed e tem auto-refresh', async () => {
  const r = await fetch(`${BASE}/app/admin-status.html`);
  const t = await r.text();
  assert(t.includes('/api/health/detailed'));
  assert(t.includes('setInterval'), 'tem auto-refresh');
  assert(t.includes('Auto-refresh') || t.includes('auto'));
});

await test('Página mostra os 3 cenários explicitamente', async () => {
  const r = await fetch(`${BASE}/app/admin-status.html`);
  const t = await r.text();
  assert(t.includes('portal') && t.includes('link_publico') && t.includes('manual'));
  assert(t.includes('Cenários em uso'));
});

await test('Página tem KPIs de saúde (uptime, db_backend, tempo)', async () => {
  const r = await fetch(`${BASE}/app/admin-status.html`);
  const t = await r.text();
  assert(t.includes('uptime_segundos') || t.includes('Uptime'));
  assert(t.includes('db_backend') || t.includes('DB backend'));
  assert(t.includes('tempo_consulta_ms') || t.includes('consulta em'));
});

await test('Página tem alertas operacionais (pendentes/inadimplentes)', async () => {
  const r = await fetch(`${BASE}/app/admin-status.html`);
  const t = await r.text();
  assert(t.includes('Alertas') || t.includes('alerta'));
  assert(t.includes('pendentes_aprovacao'));
  assert(t.includes('inadimplentes'));
});

await test('Link "Status" no nav admin', async () => {
  const r = await fetch(`${BASE}/app/admin.html`);
  const t = await r.text();
  assert(t.includes('admin-status.html'));
});

console.log('\n========================================');
console.log(`Status page: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
