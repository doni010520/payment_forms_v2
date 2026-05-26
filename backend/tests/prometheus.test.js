// =====================================================================
// /metrics — endpoint formato Prometheus text/plain
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[Prometheus /metrics]');

await test('endpoint /metrics responde 200 text/plain', async () => {
  const r = await fetch(`${BASE}/metrics`);
  assert(r.status === 200);
  assert(r.headers.get('content-type').includes('text/plain'));
});

await test('contém métricas básicas (up, uptime)', async () => {
  const r = await fetch(`${BASE}/metrics`);
  const t = await r.text();
  assert(t.includes('# HELP fesf_up'));
  assert(t.includes('# TYPE fesf_up gauge'));
  assert(t.includes('fesf_up 1'));
  assert(t.includes('fesf_uptime_seconds'));
});

await test('contém request counter com labels', async () => {
  // Bate algumas requests para gerar dados
  await fetch(`${BASE}/api/health/live`);
  await fetch(`${BASE}/api/health/live`);
  await fetch(`${BASE}/api/version`);
  const r = await fetch(`${BASE}/metrics`);
  const t = await r.text();
  assert(t.includes('fesf_requests_total'));
  // Deve ter linhas com method, path, status
  assert(/fesf_requests_total\{method="GET",path="\/api\/health\/live",status="200"\}/.test(t));
});

await test('contém histograma de duração', async () => {
  const r = await fetch(`${BASE}/metrics`);
  const t = await r.text();
  assert(t.includes('fesf_request_duration_ms'));
  assert(t.includes('le="50"'));
  assert(t.includes('le="+Inf"'));
  assert(t.includes('fesf_request_duration_ms_sum'));
  assert(t.includes('fesf_request_duration_ms_count'));
});

await test('contém memória Node.js', async () => {
  const r = await fetch(`${BASE}/metrics`);
  const t = await r.text();
  assert(t.includes('nodejs_memory_bytes'));
  assert(t.includes('type="heap_used"'));
  assert(t.includes('type="rss"'));
});

await test('normaliza paths com IDs (não explode cardinalidade)', async () => {
  await fetch(`${BASE}/api/envios/1`).catch(() => {});
  await fetch(`${BASE}/api/envios/42`).catch(() => {});
  await fetch(`${BASE}/api/envios/999`).catch(() => {});
  const r = await fetch(`${BASE}/metrics`);
  const t = await r.text();
  // path deve aparecer como /api/envios/:id, NÃO como /api/envios/1, /api/envios/42, etc.
  assert(/path="\/api\/envios\/:id"/.test(t), 'path normalizado: ' + t.split('\n').filter(l => l.includes('envios')).join('\n'));
  assert(!/path="\/api\/envios\/42"/.test(t), 'NÃO deve ter ID cru');
});

await test('endpoint é público (sem auth — scrape do Prometheus)', async () => {
  const r = await fetch(`${BASE}/metrics`);
  assert(r.status === 200, 'monitoring tools precisam acesso sem token');
});

console.log('\n========================================');
console.log(`Prometheus: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
