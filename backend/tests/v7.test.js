// =====================================================================
// V7: Esqueci senha, publico redireciona, operador acessa detalhe forn
// =====================================================================
import { gerarCNPJValido } from './_helpers.js';
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

console.log('\n[V7 · Setup]');
let tokenAdmin, tokenOp;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
});

// ============================================
console.log('\n[V7 · Esqueci minha senha]');

await test('POST /api/auth/esqueci-senha aceita email valido', async () => {
  const r = await req('POST', '/api/auth/esqueci-senha', { body: { email: 'maria.andrade@fesfsus.ba.gov.br' } });
  assert(r.status === 200);
  assert(r.json.ok === true);
});

await test('esqueci-senha sem email retorna 400', async () => {
  const r = await req('POST', '/api/auth/esqueci-senha', { body: {} });
  assert(r.status === 400);
});

await test('esqueci-senha de email nao-existente retorna 200 (nao revela)', async () => {
  const r = await req('POST', '/api/auth/esqueci-senha', { body: { email: 'naoexiste@x.com' } });
  // 200 com ok=true mesmo se nao existe — seguranca
  assert(r.status === 200);
  assert(r.json.ok === true);
});

await test('admin recebe notificacao do pedido de reset', async () => {
  // Faz pedido com email do operador
  await req('POST', '/api/auth/esqueci-senha', { body: { email: 'carlos.souza@fesfsus.ba.gov.br' } });
  // Admin checa notificacoes
  const r = await req('GET', '/api/notificacoes', { token: tokenAdmin });
  const visto = r.json.notificacoes.find(n => n.entidade === 'usuario' && n.mensagem.includes('reset de senha'));
  assert(visto, 'admin deve receber notificacao do pedido');
});

// ============================================
console.log('\n[V7 · Operador acessa detalhe de fornecedor (escopo)]');

await test('operador acessa detalhe de fornecedor vinculado a sua unidade', async () => {
  // Pega um fornecedor vinculado a HECC
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenOp })).json.fornecedores;
  assert(fornecs.length > 0);
  const fId = fornecs[0].id;
  const r = await req('GET', `/api/fornecedores/${fId}/detalhe`, { token: tokenOp });
  assert(r.status === 200, `status ${r.status} body ${r.text}`);
  assert(r.json.fornecedor);
});

await test('operador NAO acessa detalhe de fornecedor de outra unidade', async () => {
  // Pega um fornecedor que SO atende MRC (precisamos garantir)
  // Cria um externo so para MRC via admin
  const doc = gerarCNPJValido();
  const u = (await req('GET', '/api/unidades')).json.unidades;
  const mrcId = u.find(x => x.sigla === 'MRC').id;
  // Cria via admin como externo associado a MRC apenas
  const tokenAdminFresh = await login('maria.andrade@fesfsus.ba.gov.br');
  // O endpoint /externo cadastra com a unidade do usuario logado.
  // Para conseguir fornecedor SO em MRC, precisamos logar como operador MRC
  const tokenOpMrc = await login('beatriz.ramos@fesfsus.ba.gov.br');
  const cad = await req('POST', '/api/fornecedores/externo', {
    token: tokenOpMrc,
    body: { tipo: 'externo_pj', razao_social: 'Forn V7 SoMRC', documento: doc }
  });
  if (cad.status !== 201) throw new Error('falha ao criar externo: ' + cad.text);
  const fornMRConly = cad.json.fornecedor.id;
  // Agora operador HECC tenta acessar
  const r = await req('GET', `/api/fornecedores/${fornMRConly}/detalhe`, { token: tokenOp });
  assert(r.status === 403, `status ${r.status}`);
});

await test('admin acessa qualquer detalhe de fornecedor', async () => {
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores;
  const fId = fornecs[0].id;
  const r = await req('GET', `/api/fornecedores/${fId}/detalhe`, { token: tokenAdmin });
  assert(r.status === 200);
});

await test('fornecedor logado acessa o PROPRIO detalhe', async () => {
  const tokenF = await login('contato@empresahosp.com.br');
  // Descobrir o fornecedor_id
  const u = JSON.parse(Buffer.from(tokenF.split('.')[1], 'base64').toString());
  const r = await req('GET', `/api/fornecedores/${u.fornecedor_id}/detalhe`, { token: tokenF });
  assert(r.status === 200);
});

await test('fornecedor NAO acessa outro detalhe', async () => {
  const tokenF = await login('contato@empresahosp.com.br');
  // Tentar acessar outro fornecedor (qualquer outro)
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores;
  const u = JSON.parse(Buffer.from(tokenF.split('.')[1], 'base64').toString());
  const outroId = fornecs.find(f => f.id !== u.fornecedor_id)?.id;
  if (outroId) {
    const r = await req('GET', `/api/fornecedores/${outroId}/detalhe`, { token: tokenF });
    assert(r.status === 403);
  }
});

// ============================================
console.log('\n[V7 · Paginas UI servidas]');

for (const f of ['senha.html', 'onboarding.html', 'publico.html']) {
  await test(`GET /app/${f} retorna 200`, async () => {
    const r = await fetch(`${BASE}/app/${f}`);
    assert(r.status === 200);
    const t = await r.text();
    assert(t.includes('FESF') || t.includes('publico') || t.includes('senha'), `${f} valido`);
  });
}

await test('publico.html redireciona para form real com token', async () => {
  // Cria link real e simula como o publico.html resolveria
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenOp })).json.fornecedores;
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const mod = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe');
  const link = await req('POST', '/api/links', {
    token: tokenOp,
    body: { fornecedor_id: fornecs[0].id, unidade_id: heccId, modalidade_id: mod.id }
  });
  assert(link.status === 201);
  // lookup do token deve retornar modalidade_codigo (para publico.html redirecionar)
  const info = await req('GET', `/api/links/${link.json.link.token}`);
  assert(info.status === 200);
  assert(info.json.modalidade_codigo === 'indenizatorio_moe');
  assert(info.json.unidade_sigla === 'HECC');
});

console.log('\n========================================');
console.log(`V7: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
