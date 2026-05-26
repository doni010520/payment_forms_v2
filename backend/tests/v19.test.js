// =====================================================================
// V19: Pagamento estruturado + checklist docs + uploader id +
//      solicitar reenvio + cadencia + notif retificacao/pagamento
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

console.log('\n[V19 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V19 · Modalidades expõem documentos_esperados]');

await test('GET /api/modalidades retorna documentos_esperados', async () => {
  const r = await req('GET', '/api/modalidades');
  assert(r.status === 200);
  const moe = r.json.modalidades.find(m => m.codigo === 'indenizatorio_moe');
  assert(moe, 'modalidade moe existe');
  assert(Array.isArray(moe.documentos_esperados), 'documentos_esperados eh array');
  assert(moe.documentos_esperados.length >= 5, 'tem pelo menos 5 docs esperados');
  assert(moe.documentos_esperados.some(d => d.obrigatorio === true), 'tem campos obrigatorios');
});

// ============================================
console.log('\n[V19 · Uploader identity]');

let envioComUploader, docId;
await test('upload doc grava uploaded_por_nome', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V19-1' } });
  envioComUploader = r.json.envio.id;
  const fd = new FormData();
  fd.append('arquivo', new Blob(['x'], { type: 'application/pdf' }), 'nf.pdf');
  fd.append('campo', 'nf');
  const r2 = await fetch(`${BASE}/api/envios/${envioComUploader}/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenForn}` }, body: fd,
  });
  assert(r2.status === 201, 'upload');
  const j = await r2.json();
  docId = j.documento.id;
  const r3 = await req('GET', `/api/envios/${envioComUploader}`, { token: tokenOp });
  const doc = r3.json.documentos.find(d => d.id === docId);
  assert(doc.uploaded_por_nome, 'tem nome do uploader');
  assert(doc.uploaded_por_nome.includes('Hospitalar') || doc.uploaded_por_nome.length > 0, 'nome populado');
});

// ============================================
console.log('\n[V19 · Checklist de documentos esperados no GET envio]');

await test('GET envio inclui documentos_esperados da modalidade', async () => {
  const r = await req('GET', `/api/envios/${envioComUploader}`, { token: tokenOp });
  assert(Array.isArray(r.json.documentos_esperados));
  assert(r.json.documentos_esperados.length >= 5, 'tem checklist da modalidade');
});

// ============================================
console.log('\n[V19 · Solicitar reenvio]');

await test('operador solicita reenvio de campo "nf"', async () => {
  const r = await req('POST', `/api/envios/${envioComUploader}/solicitar-reenvio`, {
    token: tokenOp, body: { campo: 'nf', motivo: 'arquivo borrado, ilegivel', documento_id: docId }
  });
  assert(r.status === 201);
  assert(r.json.fornecedor_usuarios_notificados >= 1);
});

await test('GET envio inclui reenvios (status aberta)', async () => {
  const r = await req('GET', `/api/envios/${envioComUploader}`, { token: tokenOp });
  assert(Array.isArray(r.json.reenvios));
  assert(r.json.reenvios.length === 1);
  assert(r.json.reenvios[0].status === 'aberta');
});

await test('fornecedor recebe notificacao de reenvio', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenForn });
  const n = r.json.notificacoes.find(x => x.entidade === 'envio' && x.entidade_id === envioComUploader && x.mensagem.includes('Reenvio'));
  assert(n, 'fornecedor notificado');
});

await test('novo upload no mesmo campo fecha reenvio (status atendida)', async () => {
  const fd = new FormData();
  fd.append('arquivo', new Blob(['novo'], { type: 'application/pdf' }), 'nf-corrigida.pdf');
  fd.append('campo', 'nf');
  const r = await fetch(`${BASE}/api/envios/${envioComUploader}/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenForn}` }, body: fd,
  });
  assert(r.status === 201, 'upload corrigido');
  const r2 = await req('GET', `/api/envios/${envioComUploader}`, { token: tokenOp });
  const aberto = (r2.json.reenvios || []).filter(x => x.status === 'aberta');
  assert(aberto.length === 0, 'reenvio agora atendido');
});

await test('motivo curto rejeita reenvio (400)', async () => {
  const r = await req('POST', `/api/envios/${envioComUploader}/solicitar-reenvio`, {
    token: tokenOp, body: { campo: 'nf', motivo: 'oi' }
  });
  assert(r.status === 400);
});

await test('fornecedor NAO pode solicitar reenvio (403)', async () => {
  const r = await req('POST', `/api/envios/${envioComUploader}/solicitar-reenvio`, {
    token: tokenForn, body: { campo: 'nf', motivo: 'tentando' }
  });
  assert(r.status === 403);
});

// ============================================
console.log('\n[V19 · Notificação ao operador quando fornecedor retifica]');

let envioRetif;
await test('cria envio, operador solicita retificacao, fornecedor retifica', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V19-RET' } });
  envioRetif = r.json.envio.id;
  await req('POST', `/api/envios/${envioRetif}/solicitar-retificacao`, { token: tokenOp, body: { motivo: 'NF com erro de valor' } });
  // fornecedor envia nova versao
  await req('POST', `/api/envios/${envioRetif}/versoes`, { token: tokenForn, body: { dados: { q9_valor: '1500.00' } } });
});

await test('apos retificacao, status=retificado', async () => {
  const r = await req('GET', `/api/envios/${envioRetif}`, { token: tokenOp });
  assert(r.json.envio.status === 'retificado');
});

await test('operador da unidade recebe notificacao de retificacao', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenOp });
  const n = r.json.notificacoes.find(x => x.entidade === 'envio' && x.entidade_id === envioRetif && /retific/i.test(x.mensagem));
  assert(n, 'operador notificado');
});

// ============================================
console.log('\n[V19 · Pagamento estruturado]');

let envioPago;
await test('admin aprova e marca pago com estrutura completa', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 500000, numero_nf: 'V19-PAGO' } });
  envioPago = r.json.envio.id;
  await req('POST', `/api/envios/${envioPago}/aprovar`, { token: tokenOp, body: {} });
  const r2 = await req('POST', `/api/envios/${envioPago}/marcar-pago`, {
    token: tokenAdmin,
    body: { numero_ted: 'TED20260524001', banco_pagador: 'Banco do Brasil', data_efetiva: '2026-05-24', valor_pago_centavos: 500000, observacao: 'pagamento competencia 2026-12' }
  });
  assert(r2.status === 200, 'marcar-pago retornou 200, recebeu: ' + r2.text);
});

await test('GET envio inclui pagamento estruturado', async () => {
  const r = await req('GET', `/api/envios/${envioPago}`, { token: tokenAdmin });
  assert(r.json.pagamento, 'tem pagamento');
  assert(r.json.pagamento.numero_ted === 'TED20260524001');
  assert(r.json.pagamento.banco_pagador === 'Banco do Brasil');
  assert(Number(r.json.pagamento.valor_pago_centavos) === 500000);
});

await test('marcar-pago aceita só observação (sem TED) para compat', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V19-PAGO2' } });
  await req('POST', `/api/envios/${r.json.envio.id}/aprovar`, { token: tokenOp, body: {} });
  const r2 = await req('POST', `/api/envios/${r.json.envio.id}/marcar-pago`, {
    token: tokenAdmin, body: { observacao: 'pagamento manual' }
  });
  assert(r2.status === 200);
});

await test('marcar-pago rejeita TED incompleto (400)', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V19-PAGO3' } });
  await req('POST', `/api/envios/${r.json.envio.id}/aprovar`, { token: tokenOp, body: {} });
  const r2 = await req('POST', `/api/envios/${r.json.envio.id}/marcar-pago`, {
    token: tokenAdmin, body: { numero_ted: 'TED999' /* sem banco e data */ }
  });
  assert(r2.status === 400);
});

await test('fornecedor recebe notificacao de pagamento (tipo envio_pago)', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenForn });
  const n = r.json.notificacoes.find(x => x.entidade === 'envio' && x.entidade_id === envioPago && (x.tipo === 'envio_pago' || /Pagamento processado/.test(x.mensagem)));
  assert(n, 'fornecedor notificado do pagamento');
});

// ============================================
console.log('\n[V19 · Cadência configurável por expectativa]');

await test('cria expectativa com cadencia personalizada', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const forn = (await req('GET', '/api/fornecedores', { token: tokenOp })).json.fornecedores[0];
  const r = await req('POST', '/api/expectativas', {
    token: tokenOp,
    body: { fornecedor_id: forn.id, unidade_id: heccId, modalidade_id: modId, competencia: '2026-11', prazo: '2026-12-15', origem_prevista: 'portal', cadencia: { antes: [5, 1], depois: [3, 7, 15] } }
  });
  assert(r.status === 201);
  assert(r.json.expectativa.cadencia_json, 'persistiu cadencia_json');
});

await test('cadencia invalida rejeitada (400)', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const forn = (await req('GET', '/api/fornecedores', { token: tokenOp })).json.fornecedores[0];
  const r = await req('POST', '/api/expectativas', {
    token: tokenOp,
    body: { fornecedor_id: forn.id, unidade_id: heccId, modalidade_id: modId, competencia: '2026-11', prazo: '2026-12-15', origem_prevista: 'portal', cadencia: 'invalido' }
  });
  assert(r.status === 400);
});

// ============================================
console.log('\n[V19 · UI]');

await test('envio.html tem checklist de documentos esperados', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('Checklist da modalidade'));
  assert(t.includes('documentos_esperados'));
});

await test('envio.html tem botão de Reenvio em doc-card', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('data-reenvio-doc'));
  assert(t.includes('solicitarReenvio'));
});

await test('envio.html marcar-pago coleta TED estruturado', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('Nº TED'));
  assert(t.includes('Banco pagador') || t.includes('banco_pagador'));
  assert(t.includes('marcarPagoEstruturado'));
});

await test('envio.html mostra uploader em cada doc', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('uploaded_por_nome'));
  assert(t.includes('Enviado por'));
});

await test('envio.html exibe seção de Pagamento processado', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('Pagamento processado'));
  assert(t.includes('Nº TED'));
});

console.log('\n========================================');
console.log(`V19: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
