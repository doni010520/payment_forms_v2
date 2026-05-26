// =====================================================================
// V21: SLA metrics, inadimplencia auto, badge novo em versao, bulk
//      acoes painel, trilha de alteracoes fornecedor/unidade
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

console.log('\n[V21 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V21 · SLA + serie semanal + KPI inadimplentes]');

await test('cria envios e aprova/paga para gerar SLA', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  for (let i = 0; i < 3; i++) {
    const r = await req('POST', '/api/envios/portal', { token: tokenForn,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 1000 + i, numero_nf: 'SLA-' + i } });
    await req('POST', `/api/envios/${r.json.envio.id}/aprovar`, { token: tokenOp, body: {} });
    if (i < 2) await req('POST', `/api/envios/${r.json.envio.id}/marcar-pago`, { token: tokenAdmin, body: { observacao: 'sla test' } });
  }
});

await test('GET /api/metricas retorna sla, serie_semanal e fornecedores_inadimplentes', async () => {
  const r = await req('GET', '/api/metricas', { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.sla, 'tem sla');
  assert(typeof r.json.sla.dias_ate_aprovado === 'number');
  assert(typeof r.json.sla.dias_ate_pago === 'number');
  assert(r.json.sla.n_aprovados >= 3);
  assert(r.json.sla.n_pagos >= 2);
  assert(Array.isArray(r.json.serie_semanal));
  assert(typeof r.json.fornecedores_inadimplentes === 'number');
});

// ============================================
console.log('\n[V21 · Inadimplencia bloqueia criar expectativa sem confirmacao]');

let fornInadId;
await test('marca um fornecedor como inadimplente', async () => {
  const r = await req('GET', '/api/fornecedores', { token: tokenAdmin });
  fornInadId = r.json.fornecedores[0].id;
  const r2 = await req('PATCH', `/api/fornecedores/${fornInadId}/engajamento`, {
    token: tokenAdmin, body: { status: 'inadimplente', motivo: 'recusa sistemática' }
  });
  assert(r2.status === 200);
});

await test('criar expectativa para inadimplente retorna 409 sem flag', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/expectativas', {
    token: tokenOp,
    body: { fornecedor_id: fornInadId, unidade_id: heccId, modalidade_id: modId, competencia: '2026-11', prazo: '2026-12-15', origem_prevista: 'portal' }
  });
  assert(r.status === 409);
  assert(r.json.code === 'FORNECEDOR_INADIMPLENTE');
});

await test('criar expectativa com forcar_inadimplente=true passa', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/expectativas', {
    token: tokenOp,
    body: { fornecedor_id: fornInadId, unidade_id: heccId, modalidade_id: modId, competencia: '2026-11', prazo: '2026-12-15', origem_prevista: 'portal', forcar_inadimplente: true }
  });
  assert(r.status === 201);
});

await test('volta engajamento para ativo (cleanup)', async () => {
  await req('PATCH', `/api/fornecedores/${fornInadId}/engajamento`, { token: tokenAdmin, body: { status: 'ativo' } });
});

// ============================================
console.log('\n[V21 · Documento ganha badge "novo em vN"]');

let envioRet, docV2Id;
await test('cria envio, solicita retificacao, fornecedor envia nova versao e doc', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'BADGE-1' } });
  envioRet = r.json.envio.id;
  // sobe v1 doc
  const fd1 = new FormData();
  fd1.append('arquivo', new Blob(['v1'], { type: 'text/plain' }), 'doc-v1.pdf');
  fd1.append('campo', 'nf');
  await fetch(`${BASE}/api/envios/${envioRet}/documentos`, { method: 'POST', headers: { Authorization: `Bearer ${tokenForn}` }, body: fd1 });
  // solicita ret
  await req('POST', `/api/envios/${envioRet}/solicitar-retificacao`, { token: tokenOp, body: { motivo: 'precisa corrigir nota fiscal' } });
  // cria nova versao
  await req('POST', `/api/envios/${envioRet}/versoes`, { token: tokenForn, body: { dados: { q9_valor: '200' } } });
  // sobe doc na nova versao
  const fd2 = new FormData();
  fd2.append('arquivo', new Blob(['v2'], { type: 'text/plain' }), 'doc-v2.pdf');
  fd2.append('campo', 'nf');
  const rd = await fetch(`${BASE}/api/envios/${envioRet}/documentos`, { method: 'POST', headers: { Authorization: `Bearer ${tokenForn}` }, body: fd2 });
  const jd = await rd.json();
  docV2Id = jd.documento.id;
});

await test('GET envio: doc tem versao_numero e ultima versao = 2', async () => {
  const r = await req('GET', `/api/envios/${envioRet}`, { token: tokenOp });
  const ultimaVersao = Math.max(...r.json.versoes.map(v => v.numero));
  assert(ultimaVersao === 2, 'ultima versao deve ser 2');
  const doc = r.json.documentos.find(d => d.id === docV2Id);
  assert(doc.versao_numero === 2, 'doc esta na v2');
  // doc original (v1 ou null) NAO deve ser igual a versao atual
  const docV1 = r.json.documentos.find(d => d.id !== docV2Id);
  assert(docV1.versao_numero === null || docV1.versao_numero === 1, 'doc v1 nao esta na versao atual');
});

// ============================================
console.log('\n[V21 · Bulk actions e trilha]');

let bulkIds = [];
await test('cria 3 envios em em_analise para bulk', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  for (let i = 0; i < 3; i++) {
    const r = await req('POST', '/api/envios/portal', { token: tokenForn,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 50 + i, numero_nf: 'BULK-' + i } });
    bulkIds.push(r.json.envio.id);
  }
});

await test('bulk aprovar 3 em uma chamada', async () => {
  const r = await req('POST', '/api/envios/bulk/aprovar', { token: tokenOp, body: { ids: bulkIds } });
  assert(r.status === 200);
  assert(r.json.aprovados.length === 3);
});

await test('admin-fornecedor.html tem trilha de alteracoes', async () => {
  const r = await fetch(`${BASE}/app/admin-fornecedor.html`);
  const t = await r.text();
  assert(t.includes('trilha-fornecedor'));
  assert(t.includes('Trilha de alterações'));
});

await test('admin-unidade.html tem trilha de alteracoes', async () => {
  const r = await fetch(`${BASE}/app/admin-unidade.html`);
  const t = await r.text();
  assert(t.includes('trilha-unidade'));
  assert(t.includes('Trilha de alterações'));
});

// ============================================
console.log('\n[V21 · UI]');

await test('admin-relatorios.html tem SLA + serie semanal', async () => {
  const r = await fetch(`${BASE}/app/admin-relatorios.html`);
  const t = await r.text();
  assert(t.includes('sla-content'));
  assert(t.includes('serie-content'));
  assert(t.includes('Envio → Aprovação') || t.includes('Aprovação → Pagamento'));
});

await test('admin-relatorios.html mostra KPI inadimplentes', async () => {
  const r = await fetch(`${BASE}/app/admin-relatorios.html`);
  const t = await r.text();
  assert(t.includes('fornecedores_inadimplentes') || t.includes('inadimplentes'));
});

await test('admin-fornecedores.html tem filtro engajamento', async () => {
  const r = await fetch(`${BASE}/app/admin-fornecedores.html`);
  const t = await r.text();
  assert(t.includes('f-engajamento'));
  assert(t.includes('inadimplente'));
});

await test('envio.html tem badge "novo em v"', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('novoBadge') || t.includes('novo em v'));
});

await test('painel.html tem bulk-bar e check-all-env', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('bulk-bar'));
  assert(t.includes('check-all-env'));
  assert(t.includes('bulkAprovar'));
  assert(t.includes('bulkSolicitarRet'));
});

console.log('\n========================================');
console.log(`V21: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
