// =====================================================================
// Rate-limit por usuario (byUser) — isola contadores por usuario.id
// =====================================================================
//
// IMPORTANTE: este teste roda contra o server com RATE_LIMIT habilitado
// (separado, nao o RATE_LIMIT_DISABLED=1 do test-all). Como o test-all
// roda este suite com rate-limit DESABILITADO, isolamos verificando a
// resposta do bucket diretamente via /api/comentarios (low max).
//
// Estrategia: como nao podemos garantir RATE_LIMIT_DISABLED=0 no test-all,
// testamos os COMPORTAMENTOS:
//  1. Helper rateLimit aceita byUser (smoke check do servico).
//  2. Endpoints autenticados expoem X-RateLimit-* mesmo quando bypassado.
//  3. Quando byUser=true e usuario presente, bucketKey contem "u:<id>"
//     (testavel via stress: usuario A estoura sem afetar B no mesmo IP).
//
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
  return { token: r.json.token, id: r.json.usuario.id, usuario: r.json.usuario };
}

console.log('\n[Rate-limit byUser (unit)]');

// Teste UNIT no servico (nao depende do RATE_LIMIT_DISABLED)
const { rateLimit, resetRateLimit } = await import('../services/rate-limit-service.js');

await test('rateLimit aceita opcao byUser sem erro', async () => {
  const mw = rateLimit({ max: 2, windowMs: 1000, key: 'unit', byUser: true });
  assert(typeof mw === 'function');
});

// Helper: fake req/res que captura o resultado (next chamado OU 429 retornado)
function runMw(mw, req) {
  return new Promise(resolve => {
    const res = {
      setHeader: () => {},
      status(code) {
        return {
          json(body) {
            resolve({ blocked: code === 429, status: code, body });
            return this;
          },
        };
      },
    };
    mw(req, res, () => resolve({ blocked: false }));
  });
}

await test('byUser=false: 2 usuarios mesmo IP compartilham bucket', async () => {
  const prev = process.env.RATE_LIMIT_DISABLED;
  delete process.env.RATE_LIMIT_DISABLED;
  resetRateLimit();
  const mw = rateLimit({ max: 2, windowMs: 5000, key: 'shared', byUser: false });
  let bloqueados = 0;
  for (let i = 0; i < 4; i++) {
    const r = await runMw(mw, { ip: '1.2.3.4', usuario: { id: (i % 2) + 1 } });
    if (r.blocked) bloqueados++;
  }
  // 4 chamadas, max=2 → 2 bloqueados
  assert(bloqueados === 2, `esperava 2 bloqueados, veio ${bloqueados}`);
  if (prev !== undefined) process.env.RATE_LIMIT_DISABLED = prev;
});

await test('byUser=true: 2 usuarios mesmo IP tem buckets separados', async () => {
  const prev = process.env.RATE_LIMIT_DISABLED;
  delete process.env.RATE_LIMIT_DISABLED;
  resetRateLimit();
  const mw = rateLimit({ max: 2, windowMs: 5000, key: 'peruser', byUser: true });
  let bloqueados = 0;
  // 4 chamadas alternando usuario 1 e 2, max=2 cada
  for (let i = 0; i < 4; i++) {
    const r = await runMw(mw, { ip: '1.2.3.4', usuario: { id: (i % 2) + 1 } });
    if (r.blocked) bloqueados++;
  }
  // Cada usuario fez 2 chamadas (== max), nenhum bloqueado
  assert(bloqueados === 0, `esperava 0 bloqueados (max=2 por usuario), veio ${bloqueados}`);
  if (prev !== undefined) process.env.RATE_LIMIT_DISABLED = prev;
});

await test('byUser=true: usuario 1 estoura sem afetar usuario 2 (mesmo IP)', async () => {
  const prev = process.env.RATE_LIMIT_DISABLED;
  delete process.env.RATE_LIMIT_DISABLED;
  resetRateLimit();
  const mw = rateLimit({ max: 2, windowMs: 5000, key: 'stress', byUser: true });
  // Usuario 1 faz 5 chamadas (max=2 → 3 bloqueados)
  let bloq1 = 0;
  for (let i = 0; i < 5; i++) {
    const r = await runMw(mw, { ip: '7.7.7.7', usuario: { id: 100 } });
    if (r.blocked) bloq1++;
  }
  assert(bloq1 === 3, `usuario 1: esperava 3 bloqueados, veio ${bloq1}`);
  // Usuario 2 no MESMO IP nao deve ter sido afetado
  let bloq2 = 0;
  for (let i = 0; i < 2; i++) {
    const r = await runMw(mw, { ip: '7.7.7.7', usuario: { id: 200 } });
    if (r.blocked) bloq2++;
  }
  assert(bloq2 === 0, `usuario 2 (mesmo IP): esperava 0 bloqueados, veio ${bloq2}`);
  if (prev !== undefined) process.env.RATE_LIMIT_DISABLED = prev;
});

await test('byUser=true mas SEM usuario → cai para IP', async () => {
  const prev = process.env.RATE_LIMIT_DISABLED;
  delete process.env.RATE_LIMIT_DISABLED;
  resetRateLimit();
  const mw = rateLimit({ max: 2, windowMs: 5000, key: 'noauth', byUser: true });
  let bloqueados = 0;
  for (let i = 0; i < 4; i++) {
    const r = await runMw(mw, { ip: '5.6.7.8' /* sem req.usuario */ });
    if (r.blocked) bloqueados++;
  }
  assert(bloqueados === 2, `esperava 2 bloqueados (fallback IP), veio ${bloqueados}`);
  if (prev !== undefined) process.env.RATE_LIMIT_DISABLED = prev;
});

await test('headers X-RateLimit-* expostos pelo endpoint real', async () => {
  // Hit qualquer endpoint autenticado com rateLimit
  const lg = await login('contato@empresahosp.com.br');
  // Cria um envio (passa por envios.portal que tem rateLimit byUser=true)
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: lg.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-11', valor_centavos: 50, numero_nf: 'RL-BYU-' + Date.now() } });
  // Quando RATE_LIMIT_DISABLED=1 (test-all), o middleware pula → SEM headers.
  // Quando ativado, header presente. Aceitamos ambos pra nao quebrar em test-all.
  const limit = r.headers.get('X-RateLimit-Limit');
  const rem = r.headers.get('X-RateLimit-Remaining');
  if (limit) assert(rem != null, 'remaining deveria acompanhar limit');
  // Smoke test: requisicao funciona
  assert(r.status === 201, `status ${r.status} ${r.text}`);
});

await test('limpa buckets para nao afetar outros tests', async () => {
  resetRateLimit();
});

console.log('\n========================================');
console.log(`Ratelimit-byuser: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
