// =====================================================================
// LGPD Art. 18 — fornecedor exporta próprios dados pessoais
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
  return { status: r.status, json, text, headers: r.headers };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  return r.json.token;
}

console.log('\n[LGPD · portabilidade]');

let tokenForn, tokenOp, tokenAdmin;
await test('logins', async () => {
  tokenForn = await login('contato@empresahosp.com.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
});

await test('SEM auth retorna 401', async () => {
  const r = await req('GET', '/api/me/dados-pessoais');
  assert(r.status === 401);
});

await test('operador NÃO pode usar (403 · use endpoint admin)', async () => {
  const r = await req('GET', '/api/me/dados-pessoais', { token: tokenOp });
  assert(r.status === 403);
  assert(r.json.error.includes('fornecedor'));
});

await test('admin NÃO pode usar (403)', async () => {
  const r = await req('GET', '/api/me/dados-pessoais', { token: tokenAdmin });
  assert(r.status === 403);
});

await test('fornecedor exporta dados completos', async () => {
  const r = await req('GET', '/api/me/dados-pessoais', { token: tokenForn });
  assert(r.status === 200);
  assert(r.headers.get('content-disposition').includes('attachment'));
  assert(r.headers.get('content-disposition').includes('meus-dados-fesf'));
  // Meta LGPD
  assert(r.json.meta);
  assert(r.json.meta.base_legal.includes('LGPD'));
  assert(r.json.meta.base_legal.includes('Art. 18'));
  // Dados pessoais
  const d = r.json.dados_pessoais;
  assert(d.fornecedor);
  assert(d.fornecedor.razao_social.includes('Empresa'));
  assert(Array.isArray(d.usuarios));
  assert(d.usuarios.length >= 1);
  // Sem senha_hash exposta!
  for (const u of d.usuarios) {
    assert(!('senha_hash' in u), 'usuário não pode ter senha_hash');
  }
  assert(Array.isArray(d.unidades_atendidas));
  assert(Array.isArray(d.envios));
  assert(Array.isArray(d.documentos_enviados));
  assert(Array.isArray(d.comentarios));
  assert(Array.isArray(d.notificacoes));
  assert(Array.isArray(d.auditoria_relacionada));
});

await test('fornecedor NÃO vê dados de OUTROS fornecedores', async () => {
  const r = await req('GET', '/api/me/dados-pessoais', { token: tokenForn });
  // Pega o documento DELE
  const meuDoc = r.json.dados_pessoais.fornecedor.documento;
  // Verifica que nenhum dado retornado referencia outro fornecedor
  const txt = JSON.stringify(r.json);
  // O CNPJ de outro fornecedor seed (Tec-Hospitalar) NÃO deve aparecer
  assert(!txt.includes('44555666000199'), 'CNPJ de outro fornecedor não pode vazar');
});

await test('export é auditado (lgpd_dados_exportados)', async () => {
  await req('GET', '/api/me/dados-pessoais', { token: tokenForn });
  const r = await req('GET', '/api/auditoria/sistema?acao=lgpd_dados_exportados&limit=5', { token: tokenAdmin });
  assert(r.json.trilha && r.json.trilha.length >= 1, 'export auditado');
});

await test('perfil.html tem botão Baixar meus dados', async () => {
  const r = await fetch(`${BASE}/app/perfil.html`);
  const t = await r.text();
  assert(t.includes('baixarMeusDados'));
  assert(t.includes('LGPD') || t.includes('Art. 18'));
});

console.log('\n========================================');
console.log(`LGPD: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
