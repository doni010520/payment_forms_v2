// =====================================================================
// Export CSV de emails simulados (admin)
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token, accept, raw } = {}) {
  const headers = {};
  if (accept) headers.Accept = accept;
  let bodyOut;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  // Para detectar BOM, precisamos dos bytes — text() strip-a U+FEFF automaticamente
  if (raw) {
    const ab = await r.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(ab);
    return { status: r.status, text, bytes, headers: r.headers };
  }
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  return { token: r.json.token, id: r.json.usuario.id };
}

console.log('\n[Emails CSV export]');

let admin, fornecedor;
await test('logins', async () => {
  admin = await login('maria.andrade@fesfsus.ba.gov.br');
  fornecedor = await login('contato@empresahosp.com.br');
});

await test('seed: gera alguns emails via acoes', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  for (let i = 0; i < 3; i++) {
    await req('POST', '/api/envios/portal', { token: fornecedor.token,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-05', valor_centavos: 100 + i, numero_nf: 'CSV-' + i } });
  }
});

await test('SEM auth retorna 401', async () => {
  const r = await req('GET', '/api/admin/emails.csv');
  assert(r.status === 401);
});

await test('fornecedor NAO pode exportar (403)', async () => {
  const r = await req('GET', '/api/admin/emails.csv', { token: fornecedor.token });
  assert(r.status === 403);
});

let csvBody;
await test('admin baixa CSV: 200, content-type csv, BOM presente', async () => {
  const r = await req('GET', '/api/admin/emails.csv', { token: admin.token, raw: true });
  assert(r.status === 200, `status ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  assert(ct.includes('text/csv'), `content-type=${ct}`);
  // BOM UTF-8 nos bytes brutos = EF BB BF
  assert(r.bytes[0] === 0xEF && r.bytes[1] === 0xBB && r.bytes[2] === 0xBF,
    `esperava BOM EF BB BF, vieram ${r.bytes[0].toString(16)} ${r.bytes[1].toString(16)} ${r.bytes[2].toString(16)}`);
  csvBody = r.text; // ja sem BOM (decodificado com ignoreBOM:true mas TextDecoder de toda forma strip-a)
});

await test('header Content-Disposition: attachment com filename', async () => {
  const r = await req('GET', '/api/admin/emails.csv', { token: admin.token });
  const cd = r.headers.get('content-disposition') || '';
  assert(cd.includes('attachment'), `content-disposition=${cd}`);
  assert(/filename=".*emails.*\.csv"/.test(cd), `filename ausente: ${cd}`);
});

await test('X-Total-Count exposto', async () => {
  const r = await req('GET', '/api/admin/emails.csv', { token: admin.token });
  assert(r.headers.get('X-Total-Count') != null);
});

await test('cabeçalho do CSV tem colunas esperadas', async () => {
  // 1a linha (apos BOM) = cabeçalho
  const linhas = csvBody.replace(/^﻿/, '').split(/\r?\n/);
  const header = linhas[0];
  assert(header === 'id;criado_em;destinatario;tipo;assunto;entidade;entidade_id;visualizado',
    `header inesperado: ${header}`);
});

await test('linhas têm 8 colunas separadas por ;', async () => {
  const linhas = csvBody.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  // pelo menos uma linha de dados
  if (linhas.length < 2) return; // skip se DB vazio
  const cols = linhas[1].split(';');
  // 8 colunas, mas valores com ; ficam entre aspas (não dividem)
  // Verificamos pelo menos 8 separadores apenas se nenhum valor tem ; escapado
  // Forma simpler: parseamos com regex que respeita aspas
  const re = /(?:^|;)("(?:[^"]|"")*"|[^;]*)/g;
  const matches = [...linhas[1].matchAll(re)];
  assert(matches.length === 8, `esperava 8 colunas, veio ${matches.length}`);
});

await test('filtro por tipo funciona', async () => {
  const r = await req('GET', '/api/admin/emails.csv?tipo=novo_envio', { token: admin.token });
  assert(r.status === 200);
  const linhas = r.text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  // Todas as linhas (exceto header) devem ter "novo_envio" como tipo (col 4 0-indexed)
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(';');
    assert(cols[3] === 'novo_envio', `linha ${i}: tipo=${cols[3]}`);
  }
});

await test('export gera entrada de auditoria', async () => {
  await req('GET', '/api/admin/emails.csv', { token: admin.token });
  const aud = await req('GET', '/api/auditoria/sistema?acao=emails_exportados', { token: admin.token });
  assert(aud.status === 200);
  assert(aud.json.trilha.length > 0, 'auditoria de export ausente');
});

await test('Access-Control-Expose-Headers inclui X-Truncated', async () => {
  const r = await req('GET', '/api/admin/emails.csv', { token: admin.token });
  const exp = r.headers.get('Access-Control-Expose-Headers') || '';
  assert(exp.includes('X-Truncated'), `expose=${exp}`);
});

console.log('\n========================================');
console.log(`Emails-CSV: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
