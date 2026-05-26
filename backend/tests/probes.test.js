// =====================================================================
// Liveness + Readiness probes (K8s)
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[K8s probes]');

await test('/api/health/live retorna 200 e é rápido', async () => {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/health/live`);
  const dur = Date.now() - t0;
  assert(r.status === 200);
  const j = await r.json();
  assert(j.status === 'alive');
  assert(dur < 100, `liveness deve ser rápido: ${dur}ms`);
});

await test('/api/health/live NÃO faz query no DB', async () => {
  // Não temos como verificar isso diretamente, mas o endpoint responde mesmo se DB lento
  const r = await fetch(`${BASE}/api/health/live`);
  const j = await r.json();
  assert(j.status === 'alive');
  assert(!j.checks, 'liveness deve ser minimalista, sem checks');
});

await test('/api/health/ready retorna 200 com checks detalhados', async () => {
  const r = await fetch(`${BASE}/api/health/ready`);
  assert(r.status === 200);
  const j = await r.json();
  assert(j.status === 'ready');
  assert(j.checks.db && j.checks.db.ok === true);
  assert(typeof j.checks.db.latency_ms === 'number');
  assert(j.checks.schema && j.checks.schema.ok === true);
  assert(j.checks.schema.unidades_count >= 1);
  assert(j.checks.migrations && j.checks.migrations.ok === true);
  assert(j.checks.migrations.aplicadas >= 2);
});

await test('/api/health retorna 200 (alias legado)', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert(r.status === 200);
  const j = await r.json();
  assert(j.ok === true);
});

await test('probes são públicos (sem auth)', async () => {
  for (const p of ['/api/health/live', '/api/health/ready', '/api/health']) {
    const r = await fetch(`${BASE}${p}`);
    assert(r.status !== 401, `${p} não deve exigir auth`);
  }
});

console.log('\n========================================');
console.log(`Probes: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
