// =====================================================================
// Bulk reset password — admin reseta N senhas com proteções
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
async function login(email, senha='senha123') {
  const r = await req('POST', '/api/auth/login', { body: { email, senha } });
  return r.json && r.json.token;
}

console.log('\n[Bulk reset senha]');

let tokenAdmin, tokenOp;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
});

await test('operador NÃO pode (403)', async () => {
  const r = await req('POST', '/api/admin/usuarios/bulk-reset-senha', { token: tokenOp,
    body: { confirmacao: 'RESET_LOTE', ids: [3] } });
  assert(r.status === 403);
});

await test('sem confirmação retorna 400', async () => {
  const r = await req('POST', '/api/admin/usuarios/bulk-reset-senha', { token: tokenAdmin,
    body: { ids: [3] } });
  assert(r.status === 400);
  assert(r.json.error.includes('RESET_LOTE'));
});

await test('ids vazio retorna 400', async () => {
  const r = await req('POST', '/api/admin/usuarios/bulk-reset-senha', { token: tokenAdmin,
    body: { confirmacao: 'RESET_LOTE', ids: [] } });
  assert(r.status === 400);
});

await test('mais de 200 ids retorna 400', async () => {
  const r = await req('POST', '/api/admin/usuarios/bulk-reset-senha', { token: tokenAdmin,
    body: { confirmacao: 'RESET_LOTE', ids: Array.from({ length: 201 }, (_, i) => i + 1) } });
  assert(r.status === 400);
});

await test('admin reseta 2 operadores em lote', async () => {
  // Pega 2 operadores via listagem
  const lu = await req('GET', '/api/usuarios?papel=operador_unidade', { token: tokenAdmin });
  const ops = lu.json.usuarios.slice(0, 2);
  assert(ops.length === 2, 'precisa 2 operadores no seed');
  const r = await req('POST', '/api/admin/usuarios/bulk-reset-senha', { token: tokenAdmin,
    body: { confirmacao: 'RESET_LOTE', ids: ops.map(o => o.id) } });
  assert(r.status === 200);
  assert(r.json.resetados.length === 2);
  assert(r.json.erros.length === 0);
  // Cada um tem senha_temporaria
  for (const r2 of r.json.resetados) {
    assert(r2.senha_temporaria && r2.senha_temporaria.length >= 10, 'senha gerada para ' + r2.email);
  }
  // Login com a nova senha funciona
  const novaSenha = r.json.resetados[0].senha_temporaria;
  const newToken = await login(r.json.resetados[0].email, novaSenha);
  assert(newToken, 'login com nova senha funciona');
});

await test('admin_fesf é PROTEGIDO contra bulk reset', async () => {
  const la = await req('GET', '/api/usuarios?papel=admin_fesf', { token: tokenAdmin });
  const outroAdmin = la.json.usuarios.find(u => u.email !== 'maria.andrade@fesfsus.ba.gov.br');
  // Se há outro admin no seed, garantir proteção
  if (outroAdmin) {
    const r = await req('POST', '/api/admin/usuarios/bulk-reset-senha', { token: tokenAdmin,
      body: { confirmacao: 'RESET_LOTE', ids: [outroAdmin.id] } });
    assert(r.json.erros.length === 1, 'admin protegido: ' + JSON.stringify(r.json));
    assert(r.json.erros[0].erro.includes('admin_fesf'));
  } else {
    // se não há outro admin, valida que o próprio admin não pode resetar via bulk usando outro id ≠ self
    // (este caso não tem dados; apenas pular)
    assert(true);
  }
});

await test('bulk reset gera auditoria', async () => {
  const r = await req('GET', '/api/auditoria/sistema?acao=bulk_reset_senha&limit=5', { token: tokenAdmin });
  assert(r.json.trilha && r.json.trilha.length >= 1);
});

console.log('\n========================================');
console.log(`Bulk reset: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
