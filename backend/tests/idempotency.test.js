// =====================================================================
// Idempotency keys (X-Idempotency-Key) — defesa contra double-submit
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token, headers: extra } = {}) {
  const headers = { ...extra };
  let bodyOut;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, replay: r.headers.get('x-idempotent-replay') === 'true' };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  return r.json.token;
}

console.log('\n[Idempotency keys]');

let tokenForn, heccId, modId;
await test('setup', async () => {
  tokenForn = await login('contato@empresahosp.com.br');
  heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
});

await test('POST sem key funciona normal', async () => {
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'IDEMP-A' } });
  assert(r.status === 201);
  assert(r.replay === false, 'sem key, sem replay');
});

await test('POST com key cria UM envio; replay retorna mesma resposta sem duplicar', async () => {
  const key = 'test-idemp-' + Date.now();
  const r1 = await req('POST', '/api/envios/portal', { token: tokenForn,
    headers: { 'X-Idempotency-Key': key },
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 200, numero_nf: 'IDEMP-B' } });
  assert(r1.status === 201, '1ª chamada: ' + r1.text);
  const envio1Id = r1.json.envio.id;
  assert(r1.replay === false);

  // Replay: mesma key
  const r2 = await req('POST', '/api/envios/portal', { token: tokenForn,
    headers: { 'X-Idempotency-Key': key },
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 200, numero_nf: 'IDEMP-B' } });
  assert(r2.status === 201, '2ª chamada deve retornar cached 201');
  assert(r2.replay === true, 'header X-Idempotent-Replay: true');
  assert(r2.json.envio.id === envio1Id, 'mesmo ID retornado, sem duplicar');
});

await test('keys diferentes criam envios separados', async () => {
  const k1 = 'sep-1-' + Date.now();
  const k2 = 'sep-2-' + Date.now();
  // V201: NFs distintas para nao bater no dedup (fornecedor+NF+competencia)
  const ts = Date.now();
  const r1 = await req('POST', '/api/envios/portal', { token: tokenForn,
    headers: { 'X-Idempotency-Key': k1 },
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 300, numero_nf: 'IDEMP-C1-' + ts } });
  const r2 = await req('POST', '/api/envios/portal', { token: tokenForn,
    headers: { 'X-Idempotency-Key': k2 },
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 300, numero_nf: 'IDEMP-C2-' + ts } });
  assert(r1.status === 201 && r2.status === 201, `r1=${r1.status} r2=${r2.status}`);
  assert(r1.json.envio.id !== r2.json.envio.id, 'keys distintas → envios distintos');
});

await test('key malformada (< 8 chars) retorna 400', async () => {
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    headers: { 'X-Idempotency-Key': 'xy' },
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'IDEMP-X' } });
  assert(r.status === 400);
  assert(r.json.error.includes('Idempotency'));
});

await test('key com caracteres inválidos retorna 400', async () => {
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    headers: { 'X-Idempotency-Key': 'has space here' },
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'IDEMP-X' } });
  assert(r.status === 400);
});

await test('idempotency funciona em link público também', async () => {
  // criar link com fornecedor_id obrigatório
  const tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  const tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  const forn = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores[0];
  const lr = await req('POST', '/api/links', { token: tokenOp,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-05', fornecedor_id: forn.id, email_destinatario: 'x@y.com' } });
  if (!lr.json.link) throw new Error('link not created: ' + lr.text);
  const linkToken = lr.json.link.token;
  const key = 'pub-' + Date.now();
  const r1 = await req('POST', `/api/envios/publico/${linkToken}`, {
    headers: { 'X-Idempotency-Key': key },
    body: { competencia: '2026-05', valor_centavos: 999, numero_nf: 'PUB-IDEMP', submetente_nome: 'João', submetente_documento: '11222333000181' } });
  assert(r1.status === 201, 'r1: ' + r1.text);
  const r2 = await req('POST', `/api/envios/publico/${linkToken}`, {
    headers: { 'X-Idempotency-Key': key },
    body: { competencia: '2026-05', valor_centavos: 999, numero_nf: 'PUB-IDEMP', submetente_nome: 'João', submetente_documento: '11222333000181' } });
  assert(r2.replay === true, 'replay em link público');
  assert(r2.json.envio.id === r1.json.envio.id);
});

console.log('\n========================================');
console.log(`Idempotency: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
