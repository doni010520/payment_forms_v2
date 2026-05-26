// =====================================================================
// Housekeeping cron interno: lock single-instance, status, execucao manual
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

console.log('\n[Housekeeping cron]');

let admToken, fornToken;
await test('login admin', async () => { admToken = await login('maria.andrade@fesfsus.ba.gov.br'); });
await test('login fornecedor', async () => { fornToken = await login('contato@empresahosp.com.br'); });

await test('GET /admin/housekeeping/status retorna jobs (todos null no primeiro boot)', async () => {
  const r = await req('GET', '/api/admin/housekeeping/status', { token: admToken });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.json.jobs, 'jobs ausente');
  assert('storage' in r.json.jobs);
  assert('notificacoes' in r.json.jobs);
  assert('auditoria' in r.json.jobs);
  assert(typeof r.json.hora_alvo === 'number');
});

await test('status endpoint exige admin (fornecedor 403)', async () => {
  const r = await req('GET', '/api/admin/housekeeping/status', { token: fornToken });
  assert(r.status === 403, `esperava 403, veio ${r.status}`);
});

let primeiroResultado;
await test('POST /admin/housekeeping/executar dispara os 3 jobs', async () => {
  const r = await req('POST', '/api/admin/housekeeping/executar', { token: admToken });
  assert(r.status === 200);
  assert(Array.isArray(r.json.rodados), 'rodados deve ser array');
  assert(Array.isArray(r.json.pulados), 'pulados deve ser array');
  // Como ninguem rodou hoje ainda, todos 3 devem ter rodado
  assert(r.json.rodados.length === 3, `rodados=${r.json.rodados.length}`);
  assert(r.json.pulados.length === 0, `pulados=${JSON.stringify(r.json.pulados)}`);
  const jobs = r.json.rodados.map(x => x.job).sort();
  assert(JSON.stringify(jobs) === '["auditoria","notificacoes","storage"]', `jobs=${jobs}`);
  primeiroResultado = r.json;
});

await test('LOCK: segunda chamada no mesmo dia pula todos (lock perdido)', async () => {
  const r = await req('POST', '/api/admin/housekeeping/executar', { token: admToken });
  assert(r.status === 200);
  // Agora todos devem estar pulados (lock ja tomado)
  assert(r.json.rodados.length === 0, `esperava 0 rodados, veio ${r.json.rodados.length}`);
  assert(r.json.pulados.length === 3, `esperava 3 pulados, veio ${r.json.pulados.length}`);
});

await test('status reflete ultima execucao (finalizado_em e resultado preenchidos)', async () => {
  const r = await req('GET', '/api/admin/housekeeping/status', { token: admToken });
  assert(r.status === 200);
  for (const job of ['storage', 'notificacoes', 'auditoria']) {
    const s = r.json.jobs[job];
    assert(s, `job ${job} sem status`);
    assert(s.status === 'ok', `${job} status=${s.status}`);
    assert(s.finalizado_em, `${job} sem finalizado_em`);
    assert(s.resultado, `${job} sem resultado`);
  }
});

await test('executar exige admin (fornecedor 403)', async () => {
  const r = await req('POST', '/api/admin/housekeeping/executar', { token: fornToken });
  assert(r.status === 403);
});

await test('executar sem auth retorna 401', async () => {
  const r = await req('POST', '/api/admin/housekeeping/executar');
  assert(r.status === 401);
});

await test('resultado do job auditoria tem dias_retencao e purgados', async () => {
  const r = await req('GET', '/api/admin/housekeeping/status', { token: admToken });
  const aud = r.json.jobs.auditoria.resultado;
  assert(aud, 'resultado auditoria ausente');
  assert(typeof aud.dias_retencao === 'number', `dias_retencao=${aud.dias_retencao}`);
  assert(typeof aud.purgados === 'number', `purgados=${aud.purgados}`);
});

console.log('\n========================================');
console.log(`Housekeeping: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
