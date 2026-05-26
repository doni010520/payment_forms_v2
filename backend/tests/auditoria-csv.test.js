// =====================================================================
// Export CSV da auditoria sistema-wide
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token, raw } = {}) {
  const headers = {};
  let bodyOut;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
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

console.log('\n[Auditoria CSV export]');

let admin, operador, fornecedor;
await test('logins', async () => {
  admin = await login('maria.andrade@fesfsus.ba.gov.br');
  operador = await login('carlos.souza@fesfsus.ba.gov.br');
  fornecedor = await login('contato@empresahosp.com.br');
});

await test('seed: gera atividade auditavel', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r1 = await req('POST', '/api/envios/portal', { token: fornecedor.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-06', valor_centavos: 100, numero_nf: 'AUD-1' } });
  await req('POST', `/api/envios/${r1.json.envio.id}/aprovar`, { token: operador.token });
});

await test('SEM auth retorna 401', async () => {
  const r = await req('GET', '/api/auditoria/sistema.csv');
  assert(r.status === 401);
});

await test('fornecedor NAO pode exportar (403)', async () => {
  const r = await req('GET', '/api/auditoria/sistema.csv', { token: fornecedor.token });
  assert(r.status === 403);
});

await test('operador NAO pode exportar (403)', async () => {
  const r = await req('GET', '/api/auditoria/sistema.csv', { token: operador.token });
  assert(r.status === 403);
});

let csvBody;
await test('admin baixa CSV: 200, content-type csv, BOM presente nos bytes', async () => {
  const r = await req('GET', '/api/auditoria/sistema.csv', { token: admin.token, raw: true });
  assert(r.status === 200, `status ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  assert(ct.includes('text/csv'), `content-type=${ct}`);
  assert(r.bytes[0] === 0xEF && r.bytes[1] === 0xBB && r.bytes[2] === 0xBF,
    `BOM ausente: ${r.bytes[0].toString(16)} ${r.bytes[1].toString(16)} ${r.bytes[2].toString(16)}`);
  csvBody = r.text;
});

await test('Content-Disposition: attachment com filename auditoria-DATA.csv', async () => {
  const r = await req('GET', '/api/auditoria/sistema.csv', { token: admin.token });
  const cd = r.headers.get('content-disposition') || '';
  assert(cd.includes('attachment'), `cd=${cd}`);
  assert(/filename=".*auditoria.*\.csv"/.test(cd), `filename ausente: ${cd}`);
});

await test('X-Total-Count exposto', async () => {
  const r = await req('GET', '/api/auditoria/sistema.csv', { token: admin.token });
  assert(r.headers.get('X-Total-Count') != null);
});

await test('cabecalho tem 9 colunas esperadas', async () => {
  const linhas = csvBody.replace(/^﻿/, '').split(/\r?\n/);
  assert(linhas[0] === 'id;criado_em;entidade;entidade_id;acao;detalhe;usuario_nome;usuario_papel;usuario_email',
    `header inesperado: ${linhas[0]}`);
});

await test('linhas têm 9 colunas (respeitando aspas)', async () => {
  const linhas = csvBody.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (linhas.length < 2) return;
  const re = /(?:^|;)("(?:[^"]|"")*"|[^;]*)/g;
  const matches = [...linhas[1].matchAll(re)];
  assert(matches.length === 9, `esperava 9 colunas, veio ${matches.length}`);
});

await test('filtro por acao=aprovado retorna so essas', async () => {
  const r = await req('GET', '/api/auditoria/sistema.csv?acao=aprovado', { token: admin.token });
  assert(r.status === 200);
  const linhas = r.text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  // col 5 (0-idx 4) eh acao
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(';');
    assert(cols[4] === 'aprovado', `linha ${i}: acao=${cols[4]}`);
  }
});

await test('export gera entrada auditoria_exportada', async () => {
  await req('GET', '/api/auditoria/sistema.csv', { token: admin.token });
  const aud = await req('GET', '/api/auditoria/sistema?acao=auditoria_exportada', { token: admin.token });
  assert(aud.status === 200);
  assert(aud.json.trilha.length > 0, 'auditoria de export ausente');
});

console.log('\n========================================');
console.log(`Auditoria-CSV: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
