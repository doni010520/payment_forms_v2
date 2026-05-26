// =====================================================================
// Stats por hora do dia (peak hours)
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token } = {}) {
  const headers = {};
  let bodyOut;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  return r.json.token;
}

console.log('\n[Peak hours]');

let tokenAdmin;
await test('login admin', async () => { tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br'); });

await test('/api/metricas inclui por_hora_dia (array 24)', async () => {
  const r = await req('GET', '/api/metricas', { token: tokenAdmin });
  assert(r.status === 200);
  assert(Array.isArray(r.json.por_hora_dia));
  assert(r.json.por_hora_dia.length === 24, 'precisa cobrir 0-23h');
  // Cada item tem hora e n
  for (const h of r.json.por_hora_dia) {
    assert(typeof h.hora === 'number' && h.hora >= 0 && h.hora <= 23);
    assert(typeof h.n === 'number' && h.n >= 0);
  }
});

await test('horas estão em ordem (0..23)', async () => {
  const r = await req('GET', '/api/metricas', { token: tokenAdmin });
  for (let i = 0; i < 24; i++) {
    assert(r.json.por_hora_dia[i].hora === i, `posição ${i}: hora ${r.json.por_hora_dia[i].hora}`);
  }
});

await test('admin-relatorios.html renderiza a seção horas', async () => {
  const r = await fetch(`${BASE}/app/admin-relatorios.html`);
  const t = await r.text();
  assert(t.includes('horas-content'));
  assert(t.includes('por hora do dia') || t.includes('Distribuição por hora'));
  assert(t.includes('Horário de pico') || t.includes('pico'));
});

console.log('\n========================================');
console.log(`Peak hours: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
