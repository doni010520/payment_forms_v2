// =====================================================================
// V3 Tests: download docs, signup, approval, auditoria
// =====================================================================
import { gerarCNPJValido, gerarCPFValido } from './_helpers.js';
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token, raw, form } = {}) {
  const headers = {};
  let bodyOut;
  if (form) bodyOut = form;
  else if (body) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  if (raw) return { status: r.status, text, response: r };
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  if (r.status !== 200) throw new Error(`login falhou ${email}: ${r.text}`);
  return { token: r.json.token, usuario: r.json.usuario };
}

console.log('\n[V3 · Setup]');
let tokenForn, tokenOp, tokenAdmin, tokenOpMrc;
let fornEmpresaId;
await test('logins basicos', async () => {
  const forn = await login('contato@empresahosp.com.br');
  tokenForn = forn.token;
  fornEmpresaId = forn.usuario.fornecedor_id;
  tokenOp = (await login('carlos.souza@fesfsus.ba.gov.br')).token;
  tokenOpMrc = (await login('beatriz.ramos@fesfsus.ba.gov.br')).token;
  tokenAdmin = (await login('maria.andrade@fesfsus.ba.gov.br')).token;
});

// ===================================================================
// AUTO-CADASTRO de fornecedor
// ===================================================================
console.log('\n[V3 · Auto-cadastro publico]');

let novoFornId;
await test('cadastro publico de novo fornecedor PJ', async () => {
  const docUnico = gerarCNPJValido(); // 14 digitos
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: {
      tipo: 'com_portal', razao_social: 'Teste V3 Hospital Ltda.', documento: docUnico,
      email: `teste-v3-${Date.now()}@hosp.com.br`, telefone: '7199998888',
      nome_contato: 'Contato V3 Teste',
      unidades_siglas: ['HECC', 'MRC'],
    }
  });
  assert(r.status === 201, `${r.status} ${r.text}`);
  assert(r.json.pendente_aprovacao === true);
  novoFornId = r.json.id;
});

await test('cadastro com CNPJ invalido (length) retorna 400', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'X Y Z', documento: '123', email: 'a@b.com' }
  });
  assert(r.status === 400);
  assert(r.json.code === 'INVALID_DOC');
});

await test('cadastro com CNPJ ja existente retorna 409', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'Duplicado', documento: '11222333000181' /* seed */, email: 'dup@dup.com' }
  });
  assert(r.status === 409);
});

await test('cadastro com tipo invalido', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'magico', razao_social: 'X', documento: '12345678901234' }
  });
  assert(r.status === 400);
});

await test('cadastro publico rejeita tipos externos (so com_portal)', async () => {
  // auto-cadastro publico nao aceita externo_pf nem externo_pj
  const r1 = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'externo_pf', razao_social: 'PF Test', documento: '11122233344', email: 'a@b.com' }
  });
  assert(r1.status === 400, 'externo_pf deve ser rejeitado');
  const r2 = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'externo_pj', razao_social: 'PJ Externo', documento: '11122233000144', email: 'a@b.com' }
  });
  assert(r2.status === 400, 'externo_pj deve ser rejeitado');
});

await test('cadastro publico exige e-mail', async () => {
  const docUnico = '66' + Date.now().toString().slice(-12);
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'Sem email', documento: docUnico /* sem email */ }
  });
  assert(r.status === 400);
  assert(r.json.code === 'INVALID_EMAIL');
});

await test('admin recebe notificacao de novo fornecedor', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenAdmin });
  const sistema = r.json.notificacoes.find(n => n.entidade === 'fornecedor' && n.entidade_id === novoFornId);
  assert(sistema, 'notificacao do novo fornecedor nao encontrada');
});

// ===================================================================
// APROVACAO de fornecedor
// ===================================================================
console.log('\n[V3 · Aprovacao de fornecedor]');

await test('admin lista pendentes', async () => {
  const r = await req('GET', '/api/fornecedores/pendentes', { token: tokenAdmin });
  assert(r.status === 200);
  assert(Array.isArray(r.json.pendentes));
  const visto = r.json.pendentes.find(f => f.id === novoFornId);
  assert(visto, 'novo fornecedor nao aparece em pendentes');
});

await test('operador NAO pode listar pendentes (403)', async () => {
  const r = await req('GET', '/api/fornecedores/pendentes', { token: tokenOp });
  assert(r.status === 403);
});

let senhaTemp = null;
await test('admin aprova fornecedor com_portal -> usuario criado + senha temp', async () => {
  const r = await req('POST', `/api/fornecedores/${novoFornId}/aprovar`, {
    token: tokenAdmin, body: { nome_contato: 'Joao Tester' }
  });
  assert(r.status === 200);
  assert(r.json.fornecedor.ativo === true);
  assert(r.json.senha_temporaria, 'senha temporaria deveria ter sido gerada');
  senhaTemp = r.json.senha_temporaria;
});

await test('reaprovar fornecedor ja processado retorna 400', async () => {
  const r = await req('POST', `/api/fornecedores/${novoFornId}/aprovar`, { token: tokenAdmin, body: {} });
  assert(r.status === 400);
});

await test('rejeitar exige motivo (5+ chars)', async () => {
  // Cria um fornecedor pendente via cadastro publico (com_portal precisa email)
  const docUnico = gerarCNPJValido();
  const r0 = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'Para Rejeitar', documento: docUnico, email: `rej-${Date.now()}@x.com`, nome_contato: 'Contato Rejeitar' }
  });
  assert(r0.status === 201, `cadastro falhou: ${r0.text}`);
  const id = r0.json.id;
  const r1 = await req('POST', `/api/fornecedores/${id}/rejeitar`, { token: tokenAdmin, body: { motivo: 'no' } });
  assert(r1.status === 400);
  const r2 = await req('POST', `/api/fornecedores/${id}/rejeitar`, { token: tokenAdmin, body: { motivo: 'CNPJ irregular' } });
  assert(r2.status === 200);
});

await test('operador nao pode aprovar fornecedor (403)', async () => {
  const docUnico = gerarCNPJValido();
  const r0 = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'Para nao aprovar', documento: docUnico, email: `n-${Date.now()}@x.com`, nome_contato: 'Contato Nao Aprov' }
  });
  assert(r0.status === 201, `cadastro falhou: ${r0.text}`);
  const r = await req('POST', `/api/fornecedores/${r0.json.id}/aprovar`, { token: tokenOp, body: {} });
  assert(r.status === 403);
});

// ===================================================================
// DOWNLOAD de documentos
// ===================================================================
console.log('\n[V3 · Download de documentos]');

let envioDownloadId, docDownloadId;
await test('upload + retrieve document via download endpoint', async () => {
  // criar envio
  const { unidades } = (await req('GET', '/api/unidades')).json;
  const heccId = unidades.find(u => u.sigla === 'HECC').id;
  const { modalidades } = (await req('GET', '/api/modalidades')).json;
  const modId = modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r0 = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 1, numero_nf: 'DL-1' }
  });
  envioDownloadId = r0.json.envio.id;
  // upload
  const fd = new FormData();
  const conteudo = 'PDF FAKE CONTEUDO DE TESTE 123';
  fd.append('arquivo', new Blob([conteudo], { type: 'application/pdf' }), 'teste.pdf');
  fd.append('campo', 'nf_pdf');
  const up = await fetch(`${BASE}/api/envios/${envioDownloadId}/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenForn}` }, body: fd
  });
  assert(up.status === 201);
  // descobrir docId
  const det = await req('GET', `/api/envios/${envioDownloadId}`, { token: tokenForn });
  docDownloadId = det.json.documentos[0].id;
  // download
  const dl = await fetch(`${BASE}/api/envios/${envioDownloadId}/documentos/${docDownloadId}/download`, {
    headers: { Authorization: `Bearer ${tokenForn}` }
  });
  assert(dl.status === 200);
  const txt = await dl.text();
  assert(txt === conteudo, `conteudo divergente: ${txt.substring(0,30)}`);
});

await test('operador da unidade tambem pode baixar', async () => {
  const dl = await fetch(`${BASE}/api/envios/${envioDownloadId}/documentos/${docDownloadId}/download`, {
    headers: { Authorization: `Bearer ${tokenOp}` }
  });
  assert(dl.status === 200);
});

await test('operador de OUTRA unidade NAO pode baixar (403)', async () => {
  const dl = await fetch(`${BASE}/api/envios/${envioDownloadId}/documentos/${docDownloadId}/download`, {
    headers: { Authorization: `Bearer ${tokenOpMrc}` }
  });
  assert(dl.status === 403);
});

await test('admin sempre pode baixar', async () => {
  const dl = await fetch(`${BASE}/api/envios/${envioDownloadId}/documentos/${docDownloadId}/download`, {
    headers: { Authorization: `Bearer ${tokenAdmin}` }
  });
  assert(dl.status === 200);
});

await test('download de docId inexistente retorna 404', async () => {
  const dl = await fetch(`${BASE}/api/envios/${envioDownloadId}/documentos/99999/download`, {
    headers: { Authorization: `Bearer ${tokenForn}` }
  });
  assert(dl.status === 404);
});

// ===================================================================
// AUDITORIA
// ===================================================================
console.log('\n[V3 · Auditoria]');

await test('admin acessa auditoria de qualquer envio', async () => {
  const r = await req('GET', `/api/auditoria?entidade=envio&entidade_id=${envioDownloadId}`, { token: tokenAdmin });
  assert(r.status === 200);
  assert(Array.isArray(r.json.trilha));
  assert(r.json.trilha.length > 0);
  // tem registro de criacao
  assert(r.json.trilha.find(t => t.acao === 'criado_portal'));
  assert(r.json.trilha.find(t => t.acao === 'documento_anexado'));
});

await test('fornecedor acessa auditoria do proprio envio', async () => {
  const r = await req('GET', `/api/auditoria?entidade=envio&entidade_id=${envioDownloadId}`, { token: tokenForn });
  assert(r.status === 200);
  assert(r.json.trilha.length > 0);
});

await test('operador de OUTRA unidade NAO acessa auditoria (403)', async () => {
  const r = await req('GET', `/api/auditoria?entidade=envio&entidade_id=${envioDownloadId}`, { token: tokenOpMrc });
  assert(r.status === 403);
});

await test('auditoria sem entidade/id retorna 400', async () => {
  const r = await req('GET', '/api/auditoria', { token: tokenAdmin });
  assert(r.status === 400);
});

await test('auditoria de envio inexistente retorna 404', async () => {
  const r = await req('GET', '/api/auditoria?entidade=envio&entidade_id=999999', { token: tokenAdmin });
  assert(r.status === 404);
});

// ===================================================================
// LOGIN com fornecedor aprovado (senha_temporaria)
// ===================================================================
console.log('\n[V3 · Login pos-aprovacao]');

await test('fornecedor recem-aprovado loga com senha temporaria', async () => {
  // Busca diretamente o fornecedor com o ID que aprovamos
  const r0 = await req('GET', '/api/fornecedores', { token: tokenAdmin });
  // Pega o que tem o id aprovado (novoFornId definido la em cima)
  const forn = r0.json.fornecedores.find(f => f.id === novoFornId);
  if (!forn) throw new Error(`fornecedor id ${novoFornId} nao encontrado na listagem`);
  if (!forn.email) throw new Error(`fornecedor sem email: ${JSON.stringify(forn)}`);
  if (!senhaTemp) throw new Error('senhaTemp nao foi capturada');
  const r = await req('POST', '/api/auth/login', { body: { email: forn.email, senha: senhaTemp } });
  assert(r.status === 200, `login falhou para ${forn.email}: ${r.text}`);
  assert(r.json.usuario.papel === 'fornecedor');
});

// ===================================================================
// Resultado
// ===================================================================
console.log('\n========================================');
console.log(`V3: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
