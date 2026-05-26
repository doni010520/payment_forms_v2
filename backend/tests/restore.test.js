// =====================================================================
// /api/admin/restore — restore companion do backup
// Testa round-trip backup → restore garantindo integridade.
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
  return r.json.token;
}

console.log('\n[Admin restore · round-trip backup→restore]');

let tokenAdmin, tokenOp;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
});

await test('sem confirmacao, restore retorna 400', async () => {
  const r = await req('POST', '/api/admin/restore', { token: tokenAdmin, body: { backup: {} } });
  assert(r.status === 400);
  assert(r.json.error.includes('SUBSTITUIR_TUDO'));
});

await test('backup sem meta retorna 400', async () => {
  const r = await req('POST', '/api/admin/restore', { token: tokenAdmin,
    body: { confirmacao: 'SUBSTITUIR_TUDO', backup: { dados: {} } } });
  assert(r.status === 400);
});

await test('operador NÃO pode restaurar (403)', async () => {
  const r = await req('POST', '/api/admin/restore', { token: tokenOp,
    body: { confirmacao: 'SUBSTITUIR_TUDO', backup: { meta: {versao_schema:'V25'}, dados: {} } } });
  assert(r.status === 403);
});

await test('round-trip: backup → restore preserva contagens', async () => {
  // Gera atividade: cria envio
  const forn = await login('contato@empresahosp.com.br');
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla==='HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo==='indenizatorio_moe').id;
  await req('POST', '/api/envios/portal', { token: forn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-05', valor_centavos: 100, numero_nf: 'BKP-TEST' } });

  // Tira backup
  const bkup = await req('GET', '/api/admin/backup', { token: tokenAdmin });
  assert(bkup.status === 200);
  const bk = bkup.json;
  const counts0 = { unidades: bk.dados.unidades.length, fornecedores: bk.dados.fornecedores.length, envios: bk.dados.envios.length };
  assert(counts0.envios >= 1, 'tem ao menos 1 envio antes do restore');

  // Restore
  const rr = await req('POST', '/api/admin/restore', { token: tokenAdmin,
    body: { confirmacao: 'SUBSTITUIR_TUDO', backup: bk } });
  assert(rr.status === 200, 'restore: ' + rr.text);
  assert(rr.json.ok === true);
  assert(rr.json.total_restaurado >= counts0.envios + counts0.unidades);
  assert(rr.json.restaurados.unidades === counts0.unidades);
  assert(rr.json.restaurados.envios === counts0.envios);
});

await test('apos restore, login com senha original ainda funciona', async () => {
  // crítico: senha_hash deve ter sido preservado por email
  const t = await login('maria.andrade@fesfsus.ba.gov.br');
  assert(t, 'admin ainda consegue login após restore');
});

await test('restore gera auditoria', async () => {
  const r = await req('GET', '/api/auditoria/sistema?acao=backup_restaurado&limit=5', { token: tokenAdmin });
  assert(r.json.trilha && r.json.trilha.length >= 1, 'auditoria do restore registrada');
});

console.log('\n========================================');
console.log(`Restore: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
