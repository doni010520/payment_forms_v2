// =====================================================================
// Security headers — defesa contra XSS/clickjacking/MIME-sniffing
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[Security headers]');

await test('X-Content-Type-Options: nosniff', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert(r.headers.get('x-content-type-options') === 'nosniff');
});

await test('X-Frame-Options: SAMEORIGIN', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert(r.headers.get('x-frame-options') === 'SAMEORIGIN');
});

await test('Referrer-Policy presente', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert(r.headers.get('referrer-policy'), 'header presente');
  assert(r.headers.get('referrer-policy').includes('strict-origin'));
});

await test('Content-Security-Policy presente e configurada', async () => {
  const r = await fetch(`${BASE}/api/health`);
  const csp = r.headers.get('content-security-policy');
  assert(csp, 'CSP presente');
  assert(csp.includes("default-src 'self'"));
  assert(csp.includes("frame-ancestors 'self'"));
  assert(csp.includes("base-uri 'self'"));
});

await test('Permissions-Policy bloqueia camera/mic/geo', async () => {
  const r = await fetch(`${BASE}/api/health`);
  const pp = r.headers.get('permissions-policy');
  assert(pp.includes('camera=()'));
  assert(pp.includes('microphone=()'));
  assert(pp.includes('geolocation=()'));
});

await test('Headers aplicados em rota estática (app HTML)', async () => {
  const r = await fetch(`${BASE}/app/login.html`);
  assert(r.headers.get('x-frame-options'), 'header aplicado em estático');
  assert(r.headers.get('content-security-policy'), 'CSP em estático');
});

await test('HSTS NÃO setado em dev (NODE_ENV != production)', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert(!r.headers.get('strict-transport-security'), 'HSTS apenas em prod');
});

await test('CORS preflight responde 204', async () => {
  const r = await fetch(`${BASE}/api/health`, { method: 'OPTIONS' });
  assert(r.status === 204);
  assert(r.headers.get('access-control-allow-methods').includes('PATCH'));
});

console.log('\n========================================');
console.log(`Security: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
