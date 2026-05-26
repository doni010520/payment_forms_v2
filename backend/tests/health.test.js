// =====================================================================
// Endpoint /api/health/detailed — diagnóstico operacional
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[Health · diagnóstico]');

await test('GET /api/health responde OK', async () => {
  const r = await fetch(`${BASE}/api/health`);
  const j = await r.json();
  assert(r.status === 200);
  assert(j.ok === true);
});

await test('GET /api/health/detailed retorna snapshot do sistema', async () => {
  const r = await fetch(`${BASE}/api/health/detailed`);
  const j = await r.json();
  assert(r.status === 200);
  assert(j.ok === true);
  assert(j.contagens);
  assert(typeof j.contagens.unidades === 'number');
  assert(typeof j.contagens.fornecedores === 'number');
  assert(typeof j.contagens.envios === 'number');
  assert(j.cenarios_em_uso);
  assert(typeof j.cenarios_em_uso.portal === 'number');
  assert(typeof j.cenarios_em_uso.link_publico === 'number');
  assert(typeof j.cenarios_em_uso.manual === 'number');
  assert(j.fornecedores);
  assert(typeof j.fornecedores.pendentes_aprovacao === 'number');
  assert(typeof j.fornecedores.inadimplentes === 'number');
  assert(typeof j.links_publicos_ativos === 'number');
  assert(typeof j.tempo_consulta_ms === 'number');
  assert(j.uptime_segundos >= 0);
});

await test('endpoint detailed é público (sem auth)', async () => {
  // explicitamente sem Authorization
  const r = await fetch(`${BASE}/api/health/detailed`);
  assert(r.status === 200, 'deve permitir acesso sem token (para monitoring tools)');
});

await test('detailed conta envios reais após seed', async () => {
  const r = await fetch(`${BASE}/api/health/detailed`);
  const j = await r.json();
  assert(j.contagens.unidades >= 1, 'tem ao menos 1 unidade');
  assert(j.contagens.modalidades >= 6, 'tem ao menos 6 modalidades seed');
  assert(j.contagens.fornecedores >= 1, 'tem ao menos 1 fornecedor');
});

console.log('\n========================================');
console.log(`Health: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
