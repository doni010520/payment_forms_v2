// =====================================================================
// V20: Recibo+pagamento, comprovante upload, engajamento fornecedor,
//      multi-unit portal, pendencias com urgencia
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

console.log('\n[V20 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V20 · Pagamento com comprovante anexado]');

let envioId, comprovDocId;
await test('cria envio, upload comprovante, marca pago referenciando o doc', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 250000, numero_nf: 'V20-CP' } });
  envioId = r.json.envio.id;
  await req('POST', `/api/envios/${envioId}/aprovar`, { token: tokenOp, body: {} });
  // upload comprovante (admin)
  const fd = new FormData();
  fd.append('arquivo', new Blob(['comprovante teste'], { type: 'application/pdf' }), 'ted-001.pdf');
  fd.append('campo', 'comprovante_pagamento');
  const ru = await fetch(`${BASE}/api/envios/${envioId}/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenAdmin}` }, body: fd,
  });
  assert(ru.status === 201, 'upload comprovante');
  comprovDocId = (await ru.json()).documento.id;
  // marca pago com referencia
  const rp = await req('POST', `/api/envios/${envioId}/marcar-pago`, {
    token: tokenAdmin,
    body: { numero_ted: 'TED-V20-001', banco_pagador: 'Banco do Brasil', data_efetiva: '2026-05-24', valor_pago_centavos: 250000, comprovante_doc_id: comprovDocId, observacao: 'pagamento com comprovante' }
  });
  assert(rp.status === 200);
});

await test('GET envio retorna pagamento com comprovante_doc_id', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenAdmin });
  assert(r.json.pagamento);
  assert(r.json.pagamento.comprovante_doc_id === comprovDocId);
});

// ============================================
console.log('\n[V20 · Status de engajamento do fornecedor]');

let fornInadId;
await test('admin marca fornecedor como inadimplente', async () => {
  const r0 = await req('GET', '/api/fornecedores', { token: tokenAdmin });
  fornInadId = r0.json.fornecedores.find(f => f.tipo === 'externo_pj' || f.tipo === 'com_portal').id;
  const r = await req('PATCH', `/api/fornecedores/${fornInadId}/engajamento`, {
    token: tokenAdmin, body: { status: 'inadimplente', motivo: 'recusa sistemática de envio' }
  });
  assert(r.status === 200);
  assert(r.json.status_engajamento === 'inadimplente');
});

await test('GET /api/fornecedores expõe status_engajamento', async () => {
  const r = await req('GET', '/api/fornecedores', { token: tokenAdmin });
  const f = r.json.fornecedores.find(x => x.id === fornInadId);
  assert(f.status_engajamento === 'inadimplente');
  assert(f.motivo_engajamento && f.motivo_engajamento.includes('recusa'));
});

await test('motivo curto rejeita inadimplencia (400)', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornInadId}/engajamento`, {
    token: tokenAdmin, body: { status: 'inadimplente', motivo: 'x' }
  });
  assert(r.status === 400);
});

await test('status invalido rejeitado (400)', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornInadId}/engajamento`, {
    token: tokenAdmin, body: { status: 'whatever' }
  });
  assert(r.status === 400);
});

await test('fornecedor nao pode mudar proprio engajamento (403)', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornInadId}/engajamento`, {
    token: tokenForn, body: { status: 'ativo' }
  });
  assert(r.status === 403);
});

await test('engajamento volta para ativo', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornInadId}/engajamento`, {
    token: tokenAdmin, body: { status: 'ativo' }
  });
  assert(r.status === 200);
  const v = await req('GET', '/api/fornecedores', { token: tokenAdmin });
  assert(v.json.fornecedores.find(x => x.id === fornInadId).status_engajamento === 'ativo');
});

// ============================================
console.log('\n[V20 · UI]');

await test('recibo.html exibe Dados do pagamento', async () => {
  const r = await fetch(`${BASE}/app/recibo.html`);
  const t = await r.text();
  assert(t.includes('Dados do pagamento'));
  assert(t.includes('pag-ted'));
  assert(t.includes('pag-banco'));
});

await test('envio.html tem modal estruturado de pagamento', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('modal-pagamento'));
  assert(t.includes('pag-comprovante'));
  assert(t.includes('form-pagamento'));
});

await test('admin-fornecedores.html tem chip de engajamento', async () => {
  const r = await fetch(`${BASE}/app/admin-fornecedores.html`);
  const t = await r.text();
  assert(t.includes('eng-chip'));
  assert(t.includes('inadimplente'));
  assert(t.includes('atualizarEngajamentoFornecedor'));
});

await test('portal.html mostra unidades atendidas e filtro', async () => {
  const r = await fetch(`${BASE}/app/portal.html`);
  const t = await r.text();
  assert(t.includes('hero-unidades'));
  assert(t.includes('f-unidade-portal'));
  assert(t.includes('Você atende'));
});

await test('painel.html pendências com urgência e bulk', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('em atraso'));
  assert(t.includes('bulk-lembrar') || t.includes('Lembrar todas atrasadas'));
});

console.log('\n========================================');
console.log(`V20: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
