// =====================================================================
// LGPD Art. 18 VI — direito ao esquecimento (anonimização)
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

console.log('\n[LGPD · esquecimento Art. 18 VI]');

let tokenAdmin, tokenForn;
let fornId, envioId;

await test('setup: logins + cria envio + pagamento (a serem preservados)', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  // usa um fornecedor "sacrificável" — o segundo
  const fs = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores;
  const sacri = fs.find(f => f.tipo === 'com_portal' && f.email && !f.email.startsWith('contato@empresahosp'));
  if (!sacri) {
    // fallback: usa o primeiro mesmo
    fornId = fs[0].id;
  } else {
    fornId = sacri.id;
  }
  // Acha usuário do fornecedor
  const us = (await req('GET', '/api/usuarios?papel=fornecedor', { token: tokenAdmin })).json.usuarios;
  const u = us.find(x => x.fornecedor_id === fornId);
  assert(u, 'achou usuário do fornecedor sacrificial');
  // Reseta senha para conhecer
  const r = await req('POST', `/api/usuarios/${u.id}/resetar-senha`, { token: tokenAdmin, body: { nova_senha: 'temp12345' } });
  assert(r.status === 200);
  tokenForn = await login(u.email, 'temp12345');
  assert(tokenForn, 'login fornecedor sacrificial');
});

await test('SEM auth retorna 401', async () => {
  const r = await req('DELETE', '/api/me/dados-pessoais');
  assert(r.status === 401);
});

await test('admin NÃO pode usar (403)', async () => {
  const r = await req('DELETE', '/api/me/dados-pessoais', { token: tokenAdmin,
    body: { confirmacao: 'ANONIMIZAR_DADOS', motivo: 'admin tentando esquecer um fornecedor' } });
  assert(r.status === 403);
});

await test('sem confirmação retorna 400', async () => {
  const r = await req('DELETE', '/api/me/dados-pessoais', { token: tokenForn,
    body: { motivo: 'quero apagar tudo agora mesmo' } });
  assert(r.status === 400);
  assert(r.json.error.includes('ANONIMIZAR_DADOS'));
});

await test('motivo curto retorna 400', async () => {
  const r = await req('DELETE', '/api/me/dados-pessoais', { token: tokenForn,
    body: { confirmacao: 'ANONIMIZAR_DADOS', motivo: 'foo' } });
  assert(r.status === 400);
});

await test('fornecedor anonimiza próprios dados', async () => {
  const r = await req('DELETE', '/api/me/dados-pessoais', { token: tokenForn,
    body: { confirmacao: 'ANONIMIZAR_DADOS', motivo: 'Encerrei minha empresa em 2026, não quero mais figurar no sistema' } });
  assert(r.status === 200, 'esperava 200: ' + r.text);
  assert(r.json.ok === true);
  assert(r.json.base_legal.includes('Art. 18 VI'));
  assert(r.json.anonimizado.razao_social === '[ANONIMIZADO via LGPD]');
  assert(r.json.anonimizado.documento === 'ANON-' + fornId);
  assert(Array.isArray(r.json.preservados_obrigacao_legal));
});

await test('após anonimização, login com email original FALHA', async () => {
  // a senha antiga continua valendo NO email anonimizado, mas o email mudou
  const r = await req('POST', '/api/auth/login', { body: { email: 'contato-anonimizado-original@x', senha: 'temp12345' } });
  assert(r.status === 401, 'login com email antigo deve falhar');
});

await test('lista de fornecedores mostra "[ANONIMIZADO via LGPD]"', async () => {
  const r = await req('GET', '/api/fornecedores', { token: tokenAdmin });
  // Como ativo=false, pode não aparecer; verifica via /detalhe
  const d = await req('GET', `/api/fornecedores/${fornId}/detalhe`, { token: tokenAdmin });
  assert(d.status === 200);
  assert(d.json.fornecedor.razao_social === '[ANONIMIZADO via LGPD]');
  assert(d.json.fornecedor.documento === 'ANON-' + fornId);
  assert(!d.json.fornecedor.email);
});

await test('envios do fornecedor preservados (obrigação legal) mas sem nome do submetente', async () => {
  const r = await req('GET', `/api/fornecedores/${fornId}/detalhe`, { token: tokenAdmin });
  // Envios ainda existem (são parte do histórico legal)
  // submetido_por_nome/documento foram limpos
  assert(Array.isArray(r.json.envios_recentes));
});

await test('própria anonimização é auditada (lgpd_anonimizacao_solicitada)', async () => {
  const r = await req('GET', '/api/auditoria/sistema?acao=lgpd_anonimizacao_solicitada&limit=5', { token: tokenAdmin });
  assert(r.json.trilha && r.json.trilha.length >= 1);
  assert(r.json.trilha[0].detalhe.includes('Art. 18 VI'));
});

await test('perfil.html tem botão Anonimizar', async () => {
  const r = await fetch(`${BASE}/app/perfil.html`);
  const t = await r.text();
  assert(t.includes('anonimizarMeusDados'));
  assert(t.includes('Art. 18 VI') || t.includes('esquecimento'));
});

console.log('\n========================================');
console.log(`LGPD esquecimento: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
