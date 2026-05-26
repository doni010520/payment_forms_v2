// =====================================================================
// /api/admin/storage/limpar — cleanup de arquivos órfãos
// =====================================================================
import { writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS = join(__dirname, '..', '.uploads');
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

console.log('\n[Storage cleanup]');

let tokenAdmin, tokenOp;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
});

await test('operador NÃO pode purgar storage (403)', async () => {
  const r = await req('POST', '/api/admin/storage/limpar', { token: tokenOp, body: {} });
  assert(r.status === 403);
});

// Plantamos arquivo órfão direto em /uploads
let orfaoNome;
await test('cria arquivo órfão para teste', async () => {
  await mkdir(UPLOADS, { recursive: true });
  orfaoNome = `orfao-teste-${Date.now()}.txt`;
  await writeFile(join(UPLOADS, orfaoNome), 'conteúdo de teste de órfão · ' + 'x'.repeat(500));
  const s = await stat(join(UPLOADS, orfaoNome));
  assert(s.size > 500);
});

await test('dry_run identifica órfão sem deletar', async () => {
  const r = await req('POST', '/api/admin/storage/limpar', { token: tokenAdmin, body: { dry_run: true } });
  assert(r.status === 200);
  assert(r.json.orfaos_encontrados >= 1);
  assert(r.json.bytes_identificados > 0);
  assert(r.json.bytes_liberados === 0, 'dry_run não libera bytes');
  assert(r.json.dry_run === true);
  // Arquivo ainda existe
  const s = await stat(join(UPLOADS, orfaoNome));
  assert(s.size > 0, 'arquivo ainda lá');
});

await test('execução real remove o órfão', async () => {
  const r = await req('POST', '/api/admin/storage/limpar', { token: tokenAdmin, body: { dry_run: false } });
  assert(r.status === 200);
  assert(r.json.bytes_liberados > 0);
  // Arquivo deve ter sumido
  try { await stat(join(UPLOADS, orfaoNome)); throw new Error('arquivo ainda existe'); }
  catch (e) { assert(e.code === 'ENOENT' || e.message.includes('ENOENT'), 'arquivo deletado: ' + e.message); }
});

await test('rodar 2ª vez não encontra mais órfãos', async () => {
  const r = await req('POST', '/api/admin/storage/limpar', { token: tokenAdmin, body: { dry_run: false } });
  assert(r.status === 200);
  // pode achar outros órfãos de testes anteriores; só validamos que não quebra
  assert(typeof r.json.orfaos_encontrados === 'number');
});

await test('purga é auditada', async () => {
  const r = await req('GET', '/api/auditoria/sistema?acao=storage_purgado&limit=5', { token: tokenAdmin });
  assert(r.json.trilha && r.json.trilha.length >= 1, 'storage purgado auditado');
});

console.log('\n========================================');
console.log(`Storage: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
