// =====================================================================
// Header X-Maintenance em TODAS as respostas durante manutencao
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
  return { status: r.status, json, text, headers: r.headers };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  return r.json.token;
}

console.log('\n[Maintenance header]');

let admToken, fornToken;

await test('login admin', async () => { admToken = await login('maria.andrade@fesfsus.ba.gov.br'); });
await test('login fornecedor', async () => { fornToken = await login('contato@empresahosp.com.br'); });

// CLEANUP defensivo: garante manutencao OFF antes de comecar
await test('setup: garante maintenance OFF', async () => {
  await req('PUT', '/api/configuracoes', { token: admToken, body: { maintenance_mode: false } });
  // Espera cache invalidar (5s) — mas como acabamos de gravar, proxima leitura busca DB
  await new Promise(r => setTimeout(r, 100));
});

await test('estado normal: header X-Maintenance ausente em GET /api/health', async () => {
  // Espera 5s+ para invalidar cache do isMaintenance se ainda estiver true
  await new Promise(r => setTimeout(r, 5200));
  const r = await req('GET', '/api/health');
  assert(r.status === 200, `health status ${r.status}`);
  assert(!r.headers.get('X-Maintenance'), `header presente: ${r.headers.get('X-Maintenance')}`);
});

await test('estado normal: header ausente em GET autenticado', async () => {
  const r = await req('GET', '/api/notificacoes', { token: fornToken });
  assert(r.status === 200);
  assert(!r.headers.get('X-Maintenance'));
});

// Ativa manutencao
await test('admin ativa maintenance_mode', async () => {
  const r = await req('PUT', '/api/configuracoes', { token: admToken, body: { maintenance_mode: true } });
  assert(r.status === 200, r.text);
  // Aguarda cache 5s expirar
  await new Promise(r => setTimeout(r, 5200));
});

await test('em manutencao: header X-Maintenance: 1 em GET /api/health', async () => {
  const r = await req('GET', '/api/health');
  assert(r.status === 200);
  assert(r.headers.get('X-Maintenance') === '1', `header=${r.headers.get('X-Maintenance')}`);
  assert(r.headers.get('X-Maintenance-Message'), 'X-Maintenance-Message ausente');
});

await test('em manutencao: header presente em GET autenticado', async () => {
  const r = await req('GET', '/api/notificacoes', { token: fornToken });
  assert(r.status === 200);
  assert(r.headers.get('X-Maintenance') === '1');
});

await test('em manutencao: writes ainda retornam 503 (comportamento preservado)', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: fornToken,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'MAINT-' + Date.now() } });
  assert(r.status === 503, `esperava 503, veio ${r.status} ${r.text}`);
  // O 503 tambem deve ter o header
  assert(r.headers.get('X-Maintenance') === '1');
});

await test('em manutencao: Access-Control-Expose-Headers inclui X-Maintenance', async () => {
  const r = await req('GET', '/api/health');
  const exp = r.headers.get('Access-Control-Expose-Headers') || '';
  assert(exp.includes('X-Maintenance'), `expose=${exp}`);
  assert(exp.includes('X-Maintenance-Message'));
});

// Desativa manutencao (cleanup)
await test('admin desativa maintenance', async () => {
  const r = await req('PUT', '/api/configuracoes', { token: admToken, body: { maintenance_mode: false } });
  assert(r.status === 200);
  await new Promise(r => setTimeout(r, 5200));
});

await test('apos desativar: header X-Maintenance some', async () => {
  const r = await req('GET', '/api/health');
  assert(!r.headers.get('X-Maintenance'), `ainda presente: ${r.headers.get('X-Maintenance')}`);
});

console.log('\n========================================');
console.log(`Maintenance-header: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
