// =====================================================================
// Request ID + structured logging
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[Logging · request ID + JSON logs]');

await test('X-Request-Id é gerado quando não fornecido', async () => {
  const r = await fetch(`${BASE}/api/health`);
  const id = r.headers.get('x-request-id');
  assert(id, 'header X-Request-Id presente');
  // UUID v4: 8-4-4-4-12 hex chars
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id), 'formato UUID: ' + id);
});

await test('X-Request-Id é propagado quando enviado pelo cliente', async () => {
  const customId = 'meu-id-de-correlacao-123';
  const r = await fetch(`${BASE}/api/health`, { headers: { 'X-Request-Id': customId } });
  assert(r.headers.get('x-request-id') === customId, 'propagou: ' + r.headers.get('x-request-id'));
});

await test('Cada request tem ID único', async () => {
  const ids = new Set();
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${BASE}/api/health`);
    ids.add(r.headers.get('x-request-id'));
  }
  assert(ids.size === 5, 'todos os IDs distintos');
});

await test('Endpoints autenticados também propagam X-Request-Id', async () => {
  const r = await fetch(`${BASE}/api/envios`);
  assert(r.headers.get('x-request-id'), 'header presente mesmo em 401');
});

console.log('\n========================================');
console.log(`Logging: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
