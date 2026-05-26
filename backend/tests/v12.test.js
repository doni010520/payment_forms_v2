// =====================================================================
// V12: Validacao CNPJ/CPF + workflow marcar-pago
// =====================================================================
import { gerarCNPJValido, gerarCPFValido } from './_helpers.js';
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

console.log('\n[V12 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V12 · Validacao CNPJ/CPF com digitos verificadores]');

await test('CNPJ valido gerado pelo helper passa', async () => {
  const cnpj = gerarCNPJValido();
  assert(cnpj.length === 14);
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'V12 Empresa', documento: cnpj, email: `v12-${Date.now()}@a.com`, nome_contato: 'Contato V12' }
  });
  assert(r.status === 201, `cnpj ${cnpj}: ${r.text}`);
});

await test('CNPJ com digitos verificadores invalidos rejeita 400', async () => {
  // CNPJ com length 14 mas digitos errados
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'V12 CNPJ Errado', documento: '11111111111199', email: 'x@x.com' }
  });
  assert(r.status === 400);
  assert(r.json.code === 'INVALID_DOC');
});

await test('CNPJ com todos digitos iguais rejeita', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'V12', documento: '11111111111111', email: 'x@x.com' }
  });
  assert(r.status === 400);
});

await test('CPF valido gerado pelo helper passa (via externo)', async () => {
  const cpf = gerarCPFValido();
  assert(cpf.length === 11);
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pf', razao_social: 'V12 PF Test', documento: cpf }
  });
  assert(r.status === 201, `cpf ${cpf}: ${r.text}`);
});

await test('CPF com digitos invalidos rejeita 400', async () => {
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pf', razao_social: 'V12 PF Errado', documento: '12345678901' }
  });
  assert(r.status === 400);
});

await test('CPF com todos digitos iguais rejeita', async () => {
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pf', razao_social: 'V12', documento: '11111111111' }
  });
  assert(r.status === 400);
});

await test('Documento muito curto rejeita', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'V12', documento: '123', email: 'x@x.com' }
  });
  assert(r.status === 400);
});

await test('CNPJ duplicado retorna 409 (depois de passar validacao)', async () => {
  const cnpj = gerarCNPJValido();
  const r1 = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'Primeiro', documento: cnpj, email: `dup1-${Date.now()}@a.com`, nome_contato: 'Contato Primeiro' }
  });
  assert(r1.status === 201);
  const r2 = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'Duplicado', documento: cnpj, email: `dup2-${Date.now()}@a.com`, nome_contato: 'Contato Dup' }
  });
  assert(r2.status === 409);
});

// ============================================
console.log('\n[V12 · Workflow marcar como pago]');

let envioId;
await test('cria envio para teste de marcar-pago', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 50000, numero_nf: 'NF-V12-PAY' }
  });
  envioId = r.json.envio.id;
});

await test('marcar-pago FALHA se envio nao foi aprovado ainda', async () => {
  const r = await req('POST', `/api/envios/${envioId}/marcar-pago`, { token: tokenAdmin, body: {} });
  assert(r.status === 400, `esperava 400 pq nao aprovado, obteve ${r.status}`);
});

await test('operador HECC aprova o envio', async () => {
  const r = await req('POST', `/api/envios/${envioId}/aprovar`, { token: tokenOp, body: {} });
  assert(r.status === 200);
  assert(r.json.status === 'aprovado');
});

await test('admin FESF marca como pago apos aprovacao', async () => {
  const r = await req('POST', `/api/envios/${envioId}/marcar-pago`, {
    token: tokenAdmin, body: { observacao: 'TED via Banco Brasil 24/05/2026' }
  });
  assert(r.status === 200, `${r.text}`);
  assert(r.json.status === 'pago');
});

await test('apos pago, novo marcar-pago retorna 400', async () => {
  const r = await req('POST', `/api/envios/${envioId}/marcar-pago`, { token: tokenAdmin, body: {} });
  assert(r.status === 400);
});

await test('operador NAO pode marcar como pago (so admin)', async () => {
  // criar outro envio aprovado
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r0 = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 10000, numero_nf: 'NF-V12-PAY2' }
  });
  await req('POST', `/api/envios/${r0.json.envio.id}/aprovar`, { token: tokenOp, body: {} });
  const r = await req('POST', `/api/envios/${r0.json.envio.id}/marcar-pago`, { token: tokenOp, body: {} });
  assert(r.status === 403);
});

await test('fornecedor NAO pode marcar como pago', async () => {
  const r = await req('POST', `/api/envios/${envioId}/marcar-pago`, { token: tokenForn, body: {} });
  assert(r.status === 403);
});

await test('apos pago, auditoria registra marcado_pago', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenAdmin });
  const acao = r.json.auditoria.find(a => a.acao === 'marcado_pago');
  assert(acao, 'acao marcado_pago nao encontrada na auditoria');
});

await test('fornecedor recebe notificacao quando envio eh marcado como pago', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenForn });
  // mensagem do tipo "Seu envio HECC-... foi pago" (ou "status alterado para pago")
  const visto = r.json.notificacoes.find(n => n.entidade_id === envioId && (n.mensagem.includes('pago') || n.mensagem.includes('PAGO')));
  assert(visto, 'fornecedor deveria ter sido notificado');
});

console.log('\n========================================');
console.log(`V12: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
