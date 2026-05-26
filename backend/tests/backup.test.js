// =====================================================================
// /api/admin/backup — export JSON completo do sistema
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
  return r;
}
async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, senha:'senha123'}) });
  return (await r.json()).token;
}

console.log('\n[Admin backup]');

let tokenAdmin, tokenOp;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
});

await test('admin baixa backup completo', async () => {
  const r = await req('GET', '/api/admin/backup', { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.headers.get('content-disposition').includes('attachment'));
  assert(r.headers.get('content-disposition').includes('fesf-backup'));
  const j = await r.json();
  assert(j.meta);
  assert(j.meta.gerado_em);
  assert(j.meta.versao_schema);
  assert(j.meta.total_registros >= 0);
  assert(j.meta.tabelas_exportadas >= 18);
  assert(j.dados);
  assert(Array.isArray(j.dados.unidades));
  assert(j.dados.unidades.length >= 1, 'tem unidades seed');
  assert(Array.isArray(j.dados.modalidades));
  assert(j.dados.modalidades.length >= 6, 'tem modalidades seed');
});

await test('backup NÃO inclui senha_hash dos usuários', async () => {
  const r = await req('GET', '/api/admin/backup', { token: tokenAdmin });
  const j = await r.json();
  const usuarios = j.dados.usuarios;
  assert(Array.isArray(usuarios) && usuarios.length > 0);
  for (const u of usuarios) {
    assert(!('senha_hash' in u), 'usuário ' + u.id + ' não deve ter senha_hash no export');
  }
});

await test('operador NÃO pode baixar backup (403)', async () => {
  const r = await req('GET', '/api/admin/backup', { token: tokenOp });
  assert(r.status === 403);
});

await test('SEM token retorna 401', async () => {
  const r = await req('GET', '/api/admin/backup');
  assert(r.status === 401);
});

await test('backup gera auditoria', async () => {
  await req('GET', '/api/admin/backup', { token: tokenAdmin });
  const r = await fetch(`${BASE}/api/auditoria/sistema?acao=backup_exportado&limit=5`, { headers: { Authorization: 'Bearer ' + tokenAdmin } });
  const j = await r.json();
  assert(j.trilha && j.trilha.length >= 1, 'auditoria do backup registrada');
});

await test('admin-status.html tem botão Backup JSON', async () => {
  const r = await fetch(`${BASE}/app/admin-status.html`);
  const t = await r.text();
  assert(t.includes('Backup JSON'));
  assert(t.includes('baixarBackup'));
});

console.log('\n========================================');
console.log(`Backup: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
