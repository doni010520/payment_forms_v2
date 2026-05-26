// =====================================================================
// V11: Consulta publica de protocolo + perfil editavel + recibo
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

console.log('\n[V11 · Setup]');
let tokenForn, tokenOp, tokenAdmin;
let envioProto = null;
await test('logins', async () => {
  tokenForn = await login('contato@empresahosp.com.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
});

await test('cria envio para testar consulta publica', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 12345, numero_nf: 'NF-V11-001', descricao: 'Para teste consulta' }
  });
  assert(r.status === 201);
  envioProto = r.json.envio.protocolo;
});

// ============================================
console.log('\n[V11 · Consulta publica de protocolo]');

await test('GET /api/envios/protocolo/:proto retorna 200 sem auth', async () => {
  const r = await req('GET', `/api/envios/protocolo/${envioProto}`);
  assert(r.status === 200);
  assert(r.json.envio);
});

await test('consulta publica retorna apenas dados nao-sensiveis', async () => {
  const r = await req('GET', `/api/envios/protocolo/${envioProto}`);
  const e = r.json.envio;
  assert(e.protocolo === envioProto);
  assert(e.status);
  assert(e.unidade_sigla);
  assert(e.modalidade_nome);
  // NAO deve retornar dados do fornecedor
  assert(!e.razao_social, 'razao_social nao deveria ser exposta publicamente');
  assert(!e.documento, 'documento nao deveria ser exposto publicamente');
  assert(!e.fornecedor_id, 'fornecedor_id nao deveria ser exposto');
});

await test('protocolo inexistente retorna 404', async () => {
  const r = await req('GET', '/api/envios/protocolo/INEX-9999-9999');
  assert(r.status === 404);
});

await test('consulta funciona mesmo sem header de auth', async () => {
  const r = await fetch(`${BASE}/api/envios/protocolo/${envioProto}`);
  assert(r.status === 200);
  const j = await r.json();
  assert(j.envio.protocolo === envioProto);
});

// ============================================
console.log('\n[V11 · Perfil editavel do fornecedor]');

await test('fornecedor logado atualiza proprio email/telefone', async () => {
  const novoTel = '7188776655';
  const r = await req('PUT', '/api/me/fornecedor', {
    token: tokenForn,
    body: { telefone: novoTel }
  });
  assert(r.status === 200);
  // verifica via detalhe
  const d = await req('GET', `/api/fornecedores/${1}/detalhe`, { token: tokenForn }); // empresa hospitalar id=1 (seed)
  // Pode nao ser 1; usar listagem
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores;
  const empresa = fornecs.find(f => f.documento === '11222333000181');
  assert(empresa.telefone === novoTel, `telefone deveria ser ${novoTel}, foi ${empresa.telefone}`);
});

await test('atualizar email invalido retorna 400', async () => {
  const r = await req('PUT', '/api/me/fornecedor', {
    token: tokenForn, body: { email: 'invalido-sem-arroba' }
  });
  assert(r.status === 400);
});

await test('operador NAO pode usar PUT /me/fornecedor (papel errado)', async () => {
  const r = await req('PUT', '/api/me/fornecedor', {
    token: tokenOp, body: { telefone: '71-tentativa' }
  });
  assert(r.status === 403);
});

await test('atualizar nome_fantasia', async () => {
  const r = await req('PUT', '/api/me/fornecedor', {
    token: tokenForn, body: { nome_fantasia: 'EH Servicos V11' }
  });
  assert(r.status === 200);
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores;
  const empresa = fornecs.find(f => f.documento === '11222333000181');
  // O nome_fantasia nao vem na listagem por padrao mas pode ser checked no detalhe
  const det = await req('GET', `/api/fornecedores/${empresa.id}/detalhe`, { token: tokenAdmin });
  assert(det.json.fornecedor.nome_fantasia === 'EH Servicos V11');
});

await test('email duplicado entre fornecedores retorna 409', async () => {
  // Tentar atualizar email para um que ja existe
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores;
  const outroEmail = fornecs.find(f => f.documento === '44555666000199')?.email; // MedSupply
  if (!outroEmail) return; // skip
  const r = await req('PUT', '/api/me/fornecedor', {
    token: tokenForn, body: { email: outroEmail }
  });
  assert(r.status === 409);
});

// ============================================
console.log('\n[V11 · UI files]');

for (const f of ['consulta.html', 'recibo.html']) {
  await test(`GET /app/${f} retorna 200`, async () => {
    const r = await fetch(`${BASE}/app/${f}`);
    assert(r.status === 200);
    const t = await r.text();
    assert(t.includes('FESF'), `${f} valida`);
  });
}

await test('consulta.html nao requer auth para carregar', async () => {
  const r = await fetch(`${BASE}/app/consulta.html`);
  assert(r.status === 200);
  const t = await r.text();
  // a pagina deve fazer a consulta via api.js sem token
  assert(t.includes('consultaPublicaProtocolo'), 'deve usar consultaPublicaProtocolo');
});

await test('login.html linka para consulta', async () => {
  const r = await fetch(`${BASE}/app/login.html`);
  const t = await r.text();
  assert(t.includes('consulta.html'), 'login deve linkar para consulta');
});

console.log('\n========================================');
console.log(`V11: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
