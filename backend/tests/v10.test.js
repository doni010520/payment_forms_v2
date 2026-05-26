// =====================================================================
// V10: Serie temporal + atividade recente da unidade (graficos painel)
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
  if (r.status !== 200) throw new Error('login: ' + r.text);
  return r.json.token;
}

console.log('\n[V10 · Setup]');
let tokenAdmin, tokenOpHecc, tokenOpMrc, tokenForn;
let heccId;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOpHecc = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenOpMrc = await login('beatriz.ramos@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
  const u = (await req('GET', '/api/unidades')).json.unidades;
  heccId = u.find(x => x.sigla === 'HECC').id;
});

// ============================================
console.log('\n[V10 · Serie temporal]');

await test('operador HECC busca serie temporal da propria unidade', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/serie`, { token: tokenOpHecc });
  assert(r.status === 200);
  assert(Array.isArray(r.json.serie));
  // Cada bucket tem total, em_analise, aguardando_ret, aprovados, rejeitados
  for (const s of r.json.serie) {
    assert(typeof s.total === 'number');
    assert(typeof s.em_analise === 'number');
    assert(s.semana, 'cada item deve ter semana');
  }
});

await test('admin busca serie de qualquer unidade', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/serie?semanas=8`, { token: tokenAdmin });
  assert(r.status === 200);
});

await test('operador MRC NAO acessa serie de HECC (403)', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/serie`, { token: tokenOpMrc });
  assert(r.status === 403);
});

await test('fornecedor NAO acessa serie (403)', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/serie`, { token: tokenForn });
  assert(r.status === 403);
});

await test('serie temporal eh ordenada cronologicamente', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/serie?semanas=12`, { token: tokenOpHecc });
  if (r.json.serie.length < 2) return;
  for (let i = 1; i < r.json.serie.length; i++) {
    const t1 = new Date(r.json.serie[i-1].semana);
    const t2 = new Date(r.json.serie[i].semana);
    assert(t1 <= t2, 'serie deve ser cronologica crescente');
  }
});

// ============================================
console.log('\n[V10 · Atividade recente]');

await test('operador HECC busca atividade da propria unidade', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/atividade`, { token: tokenOpHecc });
  assert(r.status === 200);
  assert(Array.isArray(r.json.atividade));
  assert(r.json.atividade.length > 0, 'deve ter pelo menos uma atividade do seed');
});

await test('atividade recente eh em ordem decrescente (mais recente primeiro)', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/atividade?limit=20`, { token: tokenOpHecc });
  if (r.json.atividade.length < 2) return;
  for (let i = 1; i < r.json.atividade.length; i++) {
    const t1 = new Date(r.json.atividade[i-1].criado_em);
    const t2 = new Date(r.json.atividade[i].criado_em);
    assert(t1 >= t2, 'mais recente deve vir primeiro');
  }
});

await test('atividade inclui usuario_nome e acao', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/atividade?limit=5`, { token: tokenOpHecc });
  for (const a of r.json.atividade) {
    assert('acao' in a, 'acao presente');
    assert('criado_em' in a);
    // usuario_nome pode ser null pra acoes anonimas
  }
});

await test('atividade so retorna entradas relacionadas a unidade', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/atividade?limit=30`, { token: tokenOpHecc });
  // Como query inclui envios da unidade OU expectativas da unidade,
  // todos os protocolos retornados (quando presentes) devem ser de HECC
  for (const a of r.json.atividade) {
    if (a.protocolo) {
      assert(a.protocolo.startsWith('HECC-'), `protocolo ${a.protocolo} nao eh de HECC`);
    }
  }
});

await test('admin acessa atividade de qualquer unidade', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/atividade`, { token: tokenAdmin });
  assert(r.status === 200);
});

await test('operador outra unidade rejeita 403', async () => {
  const r = await req('GET', `/api/unidades/${heccId}/atividade`, { token: tokenOpMrc });
  assert(r.status === 403);
});

// ============================================
console.log('\n[V10 · UI verificacao]');

await test('painel.html contem section chart-sidebar-wrap', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('chart-sidebar-wrap'), 'wrap nao encontrado');
  assert(t.includes('bar-chart'), 'bar-chart container nao encontrado');
  assert(t.includes('sidebar-atividade'), 'sidebar-atividade nao encontrado');
  assert(t.includes('carregarBarChart'), 'funcao chart nao encontrada');
  assert(t.includes('carregarAtividade'), 'funcao atividade nao encontrada');
});

console.log('\n========================================');
console.log(`V10: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
