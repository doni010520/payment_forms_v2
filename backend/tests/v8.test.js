// =====================================================================
// V8: Auditoria sistema-wide e melhorias finais
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

console.log('\n[V8 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V8 · Auditoria sistema-wide]');

await test('admin acessa /api/auditoria/sistema', async () => {
  const r = await req('GET', '/api/auditoria/sistema', { token: tokenAdmin });
  assert(r.status === 200);
  assert(Array.isArray(r.json.trilha));
  assert(typeof r.json.total === 'number');
});

await test('operador NAO acessa auditoria sistema (403)', async () => {
  const r = await req('GET', '/api/auditoria/sistema', { token: tokenOp });
  assert(r.status === 403);
});

await test('fornecedor NAO acessa auditoria sistema (403)', async () => {
  const r = await req('GET', '/api/auditoria/sistema', { token: tokenForn });
  assert(r.status === 403);
});

await test('filtro por entidade=envio', async () => {
  const r = await req('GET', '/api/auditoria/sistema?entidade=envio', { token: tokenAdmin });
  assert(r.status === 200);
  for (const t of r.json.trilha) assert(t.entidade === 'envio', `entidade=${t.entidade}`);
});

await test('filtro por acao=criado_portal', async () => {
  const r = await req('GET', '/api/auditoria/sistema?acao=criado_portal', { token: tokenAdmin });
  assert(r.status === 200);
  for (const t of r.json.trilha) assert(t.acao === 'criado_portal', `acao=${t.acao}`);
});

await test('paginacao limit/offset funciona', async () => {
  const r1 = await req('GET', '/api/auditoria/sistema?limit=5&offset=0', { token: tokenAdmin });
  const r2 = await req('GET', '/api/auditoria/sistema?limit=5&offset=5', { token: tokenAdmin });
  assert(r1.status === 200);
  assert(r2.status === 200);
  assert(r1.json.trilha.length <= 5);
  assert(r2.json.trilha.length <= 5);
  // Se houver dados, os IDs nao devem se sobrepor
  if (r1.json.trilha.length > 0 && r2.json.trilha.length > 0) {
    const ids1 = new Set(r1.json.trilha.map(x => x.id));
    for (const t of r2.json.trilha) assert(!ids1.has(t.id), 'paginas devem ser distintas');
  }
});

await test('auditoria sistema retorna campos esperados', async () => {
  // cria um envio rapido para ter algo no log
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 1000, numero_nf: 'AUD-V8' }
  });
  const r = await req('GET', '/api/auditoria/sistema?entidade=envio&acao=criado_portal&limit=10', { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.trilha.length > 0);
  const t = r.json.trilha[0];
  assert(typeof t.id === 'number');
  assert(typeof t.entidade === 'string');
  assert(typeof t.acao === 'string');
  assert(t.criado_em);
  // usuario_nome pode ser null para acoes anonimas, mas vem como prop
  assert('usuario_nome' in t);
});

// ============================================
console.log('\n[V8 · Operador acessa fornecedores da unidade]');

await test('operador ve fornecedores que atendem sua unidade', async () => {
  const r = await req('GET', '/api/fornecedores', { token: tokenOp });
  assert(r.status === 200);
  assert(Array.isArray(r.json.fornecedores));
  // Deve incluir Empresa Hospitalar Ltda. (seed atende HECC)
  const acharEmpresa = r.json.fornecedores.find(f => f.documento === '11222333000181');
  assert(acharEmpresa, 'Empresa Hospitalar deve aparecer (atende HECC)');
});

await test('filtro tipo=com_portal nos fornecedores da unidade', async () => {
  const r = await req('GET', '/api/fornecedores?tipo=com_portal', { token: tokenOp });
  assert(r.status === 200);
  for (const f of r.json.fornecedores) assert(f.tipo === 'com_portal');
});

await test('filtro tipo=externo_pj nos fornecedores da unidade', async () => {
  const r = await req('GET', '/api/fornecedores?tipo=externo_pj', { token: tokenOp });
  assert(r.status === 200);
  for (const f of r.json.fornecedores) assert(f.tipo === 'externo_pj');
});

// ============================================
console.log('\n[V8 · UI files servidas]');

for (const f of ['admin-auditoria.html']) {
  await test(`GET /app/${f} retorna 200`, async () => {
    const r = await fetch(`${BASE}/app/${f}`);
    assert(r.status === 200);
    const t = await r.text();
    assert(t.includes('Auditoria'), `${f} deve mencionar Auditoria`);
  });
}

await test('painel.html tem aba Fornecedores', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('data-tab="fornecedores"'), 'aba fornecedores nao encontrada');
  assert(t.includes('tab-fornecedores'), 'section tab-fornecedores nao encontrada');
});

await test('admin.html tem link para auditoria', async () => {
  const r = await fetch(`${BASE}/app/admin.html`);
  const t = await r.text();
  assert(t.includes('admin-auditoria.html'), 'link de auditoria nao encontrado em admin.html');
});

console.log('\n========================================');
console.log(`V8: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
