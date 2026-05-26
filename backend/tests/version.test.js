// =====================================================================
// /api/version — verificação de deploy / canary
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[Version endpoint]');

await test('GET /api/version retorna metadata de build', async () => {
  const r = await fetch(`${BASE}/api/version`);
  assert(r.status === 200);
  const j = await r.json();
  assert(j.app === 'fesf-portal-pagamentos');
  assert(j.versao);
  assert(j.started_at);
  assert(typeof j.uptime_segundos === 'number');
  assert(j.node_version && j.node_version.startsWith('v'));
  assert(j.schema_version);
});

await test('endpoint é público (sem auth)', async () => {
  const r = await fetch(`${BASE}/api/version`);
  assert(r.status === 200, 'monitoring tools precisam acessar sem token');
});

await test('expõe lista de capacidades', async () => {
  const r = await fetch(`${BASE}/api/version`);
  const j = await r.json();
  assert(Array.isArray(j.capacidades));
  assert(j.capacidades.includes('multi-unit-operator'));
  assert(j.capacidades.includes('pagamento-estruturado'));
  assert(j.capacidades.includes('backup-restore'));
});

await test('uptime crescendo entre 2 calls', async () => {
  const r1 = await fetch(`${BASE}/api/version`); const j1 = await r1.json();
  await new Promise(r => setTimeout(r, 1100));
  const r2 = await fetch(`${BASE}/api/version`); const j2 = await r2.json();
  assert(j2.uptime_segundos > j1.uptime_segundos, 'uptime deve crescer');
});

console.log('\n========================================');
console.log(`Version: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
