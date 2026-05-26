// =====================================================================
// V6: CRUD admin de unidades, usuarios, detalhes
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

console.log('\n[V6 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// =================================================================== UNIDADES
console.log('\n[V6 · CRUD Unidades]');

let novaUnidadeId;
await test('admin cria unidade', async () => {
  const sigla = 'V6-' + Date.now().toString().slice(-6);
  const r = await req('POST', '/api/unidades', {
    token: tokenAdmin,
    body: { sigla, nome: 'Unidade V6 Test', cidade: 'TesteCity' }
  });
  assert(r.status === 201, r.text);
  novaUnidadeId = r.json.unidade.id;
});

await test('operador NAO pode criar unidade (403)', async () => {
  const r = await req('POST', '/api/unidades', { token: tokenOp, body: { sigla: 'X1', nome: 'X', cidade: 'Y' } });
  assert(r.status === 403);
});

await test('sigla duplicada retorna 409', async () => {
  const r = await req('POST', '/api/unidades', { token: tokenAdmin, body: { sigla: 'HECC', nome: 'Conflito', cidade: 'TesteCidade' } });
  assert(r.status === 409, `status=${r.status} body=${r.text}`);
});

await test('atualizar unidade muda nome', async () => {
  const r = await req('PUT', `/api/unidades/${novaUnidadeId}`, { token: tokenAdmin, body: { nome: 'Nome Atualizado V6' } });
  assert(r.status === 200);
  assert(r.json.unidade.nome === 'Nome Atualizado V6');
});

await test('desativar e reativar unidade', async () => {
  const r1 = await req('POST', `/api/unidades/${novaUnidadeId}/desativar`, { token: tokenAdmin, body: {} });
  assert(r1.status === 200);
  assert(r1.json.ativa === false);
  const r2 = await req('POST', `/api/unidades/${novaUnidadeId}/ativar`, { token: tokenAdmin, body: {} });
  assert(r2.json.ativa === true);
});

await test('GET /api/unidades?todas=1 inclui inativas', async () => {
  // desativa a nova e verifica que vem
  await req('POST', `/api/unidades/${novaUnidadeId}/desativar`, { token: tokenAdmin, body: {} });
  const r1 = await req('GET', '/api/unidades');
  const acharSemTodas = r1.json.unidades.find(u => u.id === novaUnidadeId);
  assert(!acharSemTodas, 'sem ?todas=1 nao deve ter inativa');
  const r2 = await req('GET', '/api/unidades?todas=1');
  const acharComTodas = r2.json.unidades.find(u => u.id === novaUnidadeId);
  assert(acharComTodas, 'com ?todas=1 deve ter');
});

// =================================================================== USUARIOS
console.log('\n[V6 · CRUD Usuarios]');

let novoUsrId, novaSenha;
await test('admin cria operador novo', async () => {
  const email = `v6-${Date.now()}@fesf.test`;
  // pega uma unidade qualquer
  const u = (await req('GET', '/api/unidades')).json.unidades[0];
  const r = await req('POST', '/api/usuarios', {
    token: tokenAdmin,
    body: { papel: 'operador_unidade', nome: 'V6 Operador', email, unidade_id: u.id }
  });
  assert(r.status === 201, r.text);
  assert(r.json.id);
  assert(r.json.senha_temporaria);
  novoUsrId = r.json.id;
  novaSenha = r.json.senha_temporaria;
});

await test('operador criado faz login com senha temporaria', async () => {
  const u = (await req('GET', '/api/usuarios', { token: tokenAdmin })).json.usuarios.find(x => x.id === novoUsrId);
  assert(u, 'usuario criado deve aparecer na listagem');
  const r = await req('POST', '/api/auth/login', { body: { email: u.email, senha: novaSenha } });
  assert(r.status === 200, r.text);
});

await test('operador NAO pode criar usuario (403)', async () => {
  const r = await req('POST', '/api/usuarios', {
    token: tokenOp,
    body: { papel: 'operador_unidade', nome: 'X', email: 'x@x.com', unidade_id: 1 }
  });
  assert(r.status === 403);
});

await test('criar usuario com email invalido', async () => {
  const r = await req('POST', '/api/usuarios', {
    token: tokenAdmin,
    body: { papel: 'admin_fesf', nome: 'X', email: 'invalido' }
  });
  assert(r.status === 400);
});

await test('criar usuario com email duplicado retorna 409', async () => {
  const r = await req('POST', '/api/usuarios', {
    token: tokenAdmin,
    body: { papel: 'admin_fesf', nome: 'Dup', email: 'maria.andrade@fesfsus.ba.gov.br' }
  });
  assert(r.status === 409);
});

await test('admin reseta senha do usuario', async () => {
  const r = await req('POST', `/api/usuarios/${novoUsrId}/resetar-senha`, { token: tokenAdmin, body: {} });
  assert(r.status === 200);
  assert(r.json.senha_temporaria);
  novaSenha = r.json.senha_temporaria;
  // login com nova senha
  const u = (await req('GET', '/api/usuarios', { token: tokenAdmin })).json.usuarios.find(x => x.id === novoUsrId);
  const r2 = await req('POST', '/api/auth/login', { body: { email: u.email, senha: novaSenha } });
  assert(r2.status === 200);
});

await test('desativar usuario impede login', async () => {
  await req('PUT', `/api/usuarios/${novoUsrId}`, { token: tokenAdmin, body: { ativo: false } });
  const u = (await req('GET', '/api/usuarios', { token: tokenAdmin })).json.usuarios.find(x => x.id === novoUsrId);
  const r = await req('POST', '/api/auth/login', { body: { email: u.email, senha: novaSenha } });
  assert(r.status === 403, `esperava 403 inativo, obtido ${r.status}`);
});

// =================================================================== MINHA SENHA
console.log('\n[V6 · Alterar minha senha]');

await test('admin altera propria senha e loga com nova', async () => {
  // muda senha para nova
  const r = await req('POST', '/api/me/senha', {
    token: tokenAdmin,
    body: { senha_atual: 'senha123', nova_senha: 'novaSenha456' }
  });
  assert(r.status === 200, r.text);
  // loga com nova senha
  const r2 = await req('POST', '/api/auth/login', { body: { email: 'maria.andrade@fesfsus.ba.gov.br', senha: 'novaSenha456' } });
  assert(r2.status === 200);
  // restaura senha original (pra nao quebrar outros testes do mesmo run)
  const r3 = await req('POST', '/api/me/senha', {
    token: r2.json.token, body: { senha_atual: 'novaSenha456', nova_senha: 'senha123' }
  });
  assert(r3.status === 200);
  // V198: /me/senha rotaciona sessao → tokenAdmin antigo invalidado.
  // Refresh com novo_token retornado ou novo login.
  if (r3.json.novo_token) tokenAdmin = r3.json.novo_token;
  else {
    const relog = await req('POST', '/api/auth/login', { body: { email: 'maria.andrade@fesfsus.ba.gov.br', senha: 'senha123' } });
    tokenAdmin = relog.json.token;
  }
});

await test('alterar senha com senha atual errada retorna 401', async () => {
  const r = await req('POST', '/api/me/senha', {
    token: tokenAdmin, body: { senha_atual: 'errada', nova_senha: 'qualquer123' }
  });
  assert(r.status === 401);
});

await test('alterar senha com nova senha muito curta', async () => {
  const r = await req('POST', '/api/me/senha', {
    token: tokenAdmin, body: { senha_atual: 'senha123', nova_senha: '123' }
  });
  assert(r.status === 400);
});

// =================================================================== DETALHES
console.log('\n[V6 · Detalhes admin]');

await test('GET /api/unidades/:id/detalhe retorna stats', async () => {
  const u = (await req('GET', '/api/unidades')).json.unidades.find(x => x.sigla === 'HECC');
  const r = await req('GET', `/api/unidades/${u.id}/detalhe`, { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.totais);
  assert(typeof r.json.totais.total_envios === 'number');
  assert(Array.isArray(r.json.por_origem));
  assert(Array.isArray(r.json.ultimos_envios));
  assert(Array.isArray(r.json.operadores));
});

await test('operador acessa detalhe da PROPRIA unidade', async () => {
  const u = (await req('GET', '/api/unidades')).json.unidades.find(x => x.sigla === 'HECC');
  const r = await req('GET', `/api/unidades/${u.id}/detalhe`, { token: tokenOp });
  assert(r.status === 200);
});

await test('operador NAO acessa detalhe de outra unidade (403)', async () => {
  const u = (await req('GET', '/api/unidades')).json.unidades.find(x => x.sigla === 'MRC');
  const r = await req('GET', `/api/unidades/${u.id}/detalhe`, { token: tokenOp });
  assert(r.status === 403);
});

await test('GET /api/fornecedores/:id/detalhe retorna stats', async () => {
  const fId = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores[0].id;
  const r = await req('GET', `/api/fornecedores/${fId}/detalhe`, { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.fornecedor);
  assert(r.json.totais);
  assert(Array.isArray(r.json.unidades));
  assert(Array.isArray(r.json.envios_recentes));
});

// =================================================================== UI files served
console.log('\n[V6 · UI files servidas]');
for (const f of ['admin-unidades.html','admin-usuarios.html','admin-relatorios.html','admin-config.html','admin-fornecedor.html','admin-unidade.html']) {
  await test(`GET /app/${f} retorna 200`, async () => {
    const r = await fetch(`${BASE}/app/${f}`);
    assert(r.status === 200);
    const t = await r.text();
    assert(t.includes('FESF'), `${f} deve mencionar FESF`);
  });
}

console.log('\n========================================');
console.log(`V6: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
