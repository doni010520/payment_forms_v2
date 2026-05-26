// =====================================================================
// V4: Reforco do fluxo — cadastro publico SO com_portal,
// cadastro de externo via operador/admin
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
  if (body) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
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

console.log('\n[V4 · Setup]');
let tokenOp, tokenAdmin, tokenForn;
await test('logins', async () => {
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

console.log('\n[V4 · Auto-cadastro publico — restrito a com_portal]');

await test('auto-cadastro publico aceita com_portal', async () => {
  const doc = gerarCNPJValido();
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'V4 PJ Portal', documento: doc, email: `v4-${Date.now()}@a.com`, nome_contato: 'Contato V4' }
  });
  assert(r.status === 201, `${r.status} ${r.text}`);
});

await test('auto-cadastro publico REJEITA externo_pj', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'externo_pj', razao_social: 'V4 Ext PJ', documento: '12312312000199' }
  });
  assert(r.status === 400);
  assert(r.json.code === 'INVALID_TIPO');
});

await test('auto-cadastro publico REJEITA externo_pf', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'externo_pf', razao_social: 'V4 Ext PF', documento: '12312312399' }
  });
  assert(r.status === 400);
});

await test('auto-cadastro publico exige email (com_portal precisa pra receber senha)', async () => {
  const doc = gerarCNPJValido();
  const r = await req('POST', '/api/fornecedores/cadastrar', {
    body: { tipo: 'com_portal', razao_social: 'Sem email', documento: doc /* sem email */ }
  });
  assert(r.status === 400);
  assert(r.json.code === 'INVALID_EMAIL');
});

console.log('\n[V4 · Cadastro de externo pelo OPERADOR]');

let novoExtId;
await test('operador cadastra fornecedor externo PJ', async () => {
  const doc = gerarCNPJValido();
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pj', razao_social: 'Externo PJ V4', documento: doc, email: 'ext-pj@v4.com', telefone: '7199999999' }
  });
  assert(r.status === 201, `${r.status} ${r.text}`);
  assert(r.json.fornecedor.tipo === 'externo_pj');
  assert(r.json.fornecedor.ativo === true, 'externo nasce ativo, sem pendencia');
  assert(r.json.fornecedor.pendente_aprovacao === false);
  novoExtId = r.json.fornecedor.id;
});

await test('operador cadastra fornecedor externo PF (com CPF)', async () => {
  const cpf = gerarCPFValido();
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pf', razao_social: 'Joao Externo PF', documento: cpf, telefone: '7198888888' }
  });
  assert(r.status === 201);
  assert(r.json.fornecedor.tipo === 'externo_pf');
  assert(r.json.fornecedor.ativo === true);
});

await test('externo PJ com CNPJ invalido (11 digitos) eh rejeitado', async () => {
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pj', razao_social: 'X', documento: '12345678901' /* CPF len */ }
  });
  assert(r.status === 400);
});

await test('externo PF com CNPJ (14 digitos) eh rejeitado', async () => {
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pf', razao_social: 'X', documento: '12345678901234' /* CNPJ len */ }
  });
  assert(r.status === 400);
});

await test('cadastro externo NAO aceita com_portal (so externos)', async () => {
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'com_portal', razao_social: 'X', documento: '11111111000122', email: 'x@y.com' }
  });
  assert(r.status === 400);
  assert(r.json.code === 'INVALID_TIPO');
});

await test('fornecedor logado NAO pode usar endpoint externo (403)', async () => {
  const r = await req('POST', '/api/fornecedores/externo', {
    token: tokenForn,
    body: { tipo: 'externo_pj', razao_social: 'X', documento: '12121212000133' }
  });
  assert(r.status === 403);
});

await test('cadastro externo sem auth retorna 401', async () => {
  const r = await req('POST', '/api/fornecedores/externo', {
    body: { tipo: 'externo_pj', razao_social: 'X', documento: '12121212000144' }
  });
  assert(r.status === 401);
});

await test('externo cadastrado pelo operador fica vinculado a sua unidade', async () => {
  // listar fornecedores da unidade do operador
  const r = await req('GET', '/api/fornecedores', { token: tokenOp });
  const visto = r.json.fornecedores.find(f => f.id === novoExtId);
  assert(visto, 'externo deve aparecer na listagem da unidade do operador');
});

console.log('\n[V4 · Fluxo completo: cadastrar externo -> gerar link]');

await test('operador cadastra externo -> gera link publico em seguida', async () => {
  const doc = gerarCNPJValido();
  const cad = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pj', razao_social: 'Cad+Link V4', documento: doc, email: 'cl@v4.com' }
  });
  assert(cad.status === 201);
  const extId = cad.json.fornecedor.id;

  // descobrir unidade do operador e uma modalidade
  const unidades = (await req('GET', '/api/unidades')).json.unidades;
  const heccId = unidades.find(u => u.sigla === 'HECC').id;
  const mods = (await req('GET', '/api/modalidades')).json.modalidades;
  const modId = mods.find(m => m.codigo === 'pagamento_insumos').id;

  const link = await req('POST', '/api/links', {
    token: tokenOp,
    body: { fornecedor_id: extId, unidade_id: heccId, modalidade_id: modId, email_destinatario: 'cl@v4.com' }
  });
  assert(link.status === 201);

  // submeter via link publico (sem auth)
  const envio = await req('POST', `/api/envios/publico/${link.json.link.token}`, {
    body: { competencia: '2026-12', valor_centavos: 50000, numero_nf: 'NF-V4-001', submetente_nome: 'Externo' }
  });
  assert(envio.status === 201);
  assert(envio.json.envio.origem === 'link_publico');
});

console.log('\n[V4 · Fluxo completo: cadastrar externo -> lancar manual]');

await test('operador cadastra externo -> lanca manual em seguida', async () => {
  const cpf = gerarCPFValido();
  const doc = cpf;
  const cad = await req('POST', '/api/fornecedores/externo', {
    token: tokenOp,
    body: { tipo: 'externo_pf', razao_social: 'Cad+Manual V4', documento: doc }
  });
  assert(cad.status === 201);

  const unidades = (await req('GET', '/api/unidades')).json.unidades;
  const heccId = unidades.find(u => u.sigla === 'HECC').id;
  const mods = (await req('GET', '/api/modalidades')).json.modalidades;
  const modId = mods.find(m => m.codigo === 'pagamento_servico').id;

  const env = await req('POST', '/api/envios/manual', {
    token: tokenOp,
    body: {
      fornecedor_id: cad.json.fornecedor.id, unidade_id: heccId, modalidade_id: modId,
      competencia: '2026-12', valor_centavos: 30000,
      motivo: 'Fornecedor PF se recusou a usar o portal — lancado manualmente com autorizacao verbal',
    }
  });
  assert(env.status === 201);
  assert(env.json.envio.origem === 'manual');
});

console.log('\n========================================');
console.log(`V4: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
