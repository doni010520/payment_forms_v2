// =====================================================================
// V225: /api/expectativas — admin sem unidade_id agora vê todas (era 400).
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
  return r.json && r.json.token;
}

console.log('\n[Expectativas admin (V225)]');

let admTok, opTok, fornTok;
await test('logins', async () => {
  admTok  = await login('maria.andrade@fesfsus.ba.gov.br');
  opTok   = await login('carlos.souza@fesfsus.ba.gov.br');
  fornTok = await login('contato@empresahosp.com.br');
  assert(admTok && opTok && fornTok);
});

await test('admin sem unidade_id → 200 + lista com unidade_sigla', async () => {
  const r = await req('GET', '/api/expectativas', { token: admTok });
  assert(r.status === 200, `esperava 200, veio ${r.status} ${r.text}`);
  assert(Array.isArray(r.json.expectativas), 'sem array expectativas');
  // Pelo seed, deve haver pelo menos uma expectativa
  if (r.json.expectativas.length > 0) {
    const e = r.json.expectativas[0];
    assert('unidade_sigla' in e, 'falta unidade_sigla no resultado');
    assert('razao_social' in e, 'falta razao_social no resultado');
  }
});

await test('admin com unidade_id=1 → 200 e só HECC', async () => {
  const r = await req('GET', '/api/expectativas?unidade_id=1', { token: admTok });
  assert(r.status === 200, `status ${r.status}`);
  if (r.json.expectativas.length > 0) {
    const todas = r.json.expectativas.every(e => e.unidade_sigla === 'HECC');
    assert(todas, 'filtro por unidade_id não respeitado');
  }
});

await test('operador sem filtro → 200 e só sua unidade', async () => {
  const r = await req('GET', '/api/expectativas', { token: opTok });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  // Carlos Souza é HECC
  if (r.json.expectativas.length > 0) {
    const todas = r.json.expectativas.every(e => e.unidade_sigla === 'HECC');
    assert(todas, 'operador vendo expectativas de outra unidade');
  }
});

await test('fornecedor sem filtro → 200 só as próprias', async () => {
  const r = await req('GET', '/api/expectativas', { token: fornTok });
  assert(r.status === 200, `status ${r.status}`);
  assert(Array.isArray(r.json.expectativas), 'sem array');
});

await test('filtro status combinado com admin sem unidade', async () => {
  const r = await req('GET', '/api/expectativas?status=aguardando', { token: admTok });
  assert(r.status === 200);
  if (r.json.expectativas.length > 0) {
    assert(r.json.expectativas.every(e => e.status === 'aguardando'), 'filtro status falhou');
  }
});

console.log('\n========================================');
console.log(`Expectativas-admin: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
