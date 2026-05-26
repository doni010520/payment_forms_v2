// =====================================================================
// Revogacao de sessoes (logout forcado)
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
  return { token: r.json.token, usuarioId: r.json.usuario.id };
}

console.log('\n[Revogacao de sessoes]');

let admin, forn;
await test('login admin', async () => { admin = await login('maria.andrade@fesfsus.ba.gov.br'); });
await test('login fornecedor', async () => { forn = await login('contato@empresahosp.com.br'); });

await test('token do fornecedor valido antes da revogacao', async () => {
  const r = await req('GET', '/api/me', { token: forn.token });
  assert(r.status === 200, `esperava 200, veio ${r.status}`);
});

await test('SEM auth: revogar admin endpoint retorna 401', async () => {
  const r = await req('POST', `/api/admin/usuarios/${forn.usuarioId}/sessoes/revogar`);
  assert(r.status === 401);
});

await test('fornecedor NAO pode revogar sessoes de outro (403)', async () => {
  const r = await req('POST', `/api/admin/usuarios/${admin.usuarioId}/sessoes/revogar`, { token: forn.token });
  assert(r.status === 403, `esperava 403, veio ${r.status}`);
});

await test('admin revoga sessoes do fornecedor', async () => {
  // Espera 1s para garantir iat < revogado_apos (precisao de segundo)
  await new Promise(r => setTimeout(r, 1100));
  const r = await req('POST', `/api/admin/usuarios/${forn.usuarioId}/sessoes/revogar`,
    { token: admin.token, body: { motivo: 'teste de revogacao' } });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.ok === true);
  assert(r.json.motivo === 'teste de revogacao');
});

await test('token antigo do fornecedor agora retorna 401 SESSION_REVOKED', async () => {
  const r = await req('GET', '/api/me', { token: forn.token });
  assert(r.status === 401, `esperava 401, veio ${r.status}`);
  assert(r.json.code === 'SESSION_REVOKED' || r.json.error === 'Sessao revogada',
    `body=${JSON.stringify(r.json)}`);
});

await test('admin segue funcionando (so foi revogado o fornecedor)', async () => {
  const r = await req('GET', '/api/me', { token: admin.token });
  assert(r.status === 200);
});

await test('fornecedor faz login DE NOVO e ganha token NOVO valido', async () => {
  // Espera 2s para garantir iat > revogado_apos (margem para precisao subsegundo)
  await new Promise(r => setTimeout(r, 2100));
  forn = await login('contato@empresahosp.com.br');
  const r = await req('GET', '/api/me', { token: forn.token });
  assert(r.status === 200, `novo token deveria funcionar, veio ${r.status} ${JSON.stringify(r.json)}`);
});

await test('usuario revoga propria sessao via /me/sessoes/revogar', async () => {
  await new Promise(r => setTimeout(r, 1100));
  const r = await req('POST', '/api/me/sessoes/revogar', { token: forn.token });
  assert(r.status === 200);
  assert(r.json.ok === true);
  assert(/login/i.test(r.json.mensagem));
});

await test('apos auto-revogacao, mesmo token nao funciona mais', async () => {
  const r = await req('GET', '/api/me', { token: forn.token });
  assert(r.status === 401);
});

await test('admin revoga usuario inexistente: 404', async () => {
  const r = await req('POST', '/api/admin/usuarios/99999/sessoes/revogar', { token: admin.token });
  assert(r.status === 404);
});

await test('revogacao gera entrada de auditoria', async () => {
  // Re-login fornecedor para criar mais um token e revoga-lo (gera auditoria)
  await new Promise(r => setTimeout(r, 1100));
  const f = await login('contato@empresahosp.com.br');
  await req('POST', `/api/admin/usuarios/${f.usuarioId}/sessoes/revogar`,
    { token: admin.token, body: { motivo: 'auditoria-check' } });
  // Busca auditoria sistema-wide
  const r = await req('GET', '/api/auditoria/sistema?acao=sessoes_revogadas', { token: admin.token });
  assert(r.status === 200);
  assert(r.json.trilha.length > 0, 'auditoria deveria ter sessoes_revogadas');
});

console.log('\n========================================');
console.log(`Sessoes-revogar: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
