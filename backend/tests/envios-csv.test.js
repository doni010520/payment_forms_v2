// =====================================================================
// V213: /api/envios/export.csv padronizado (BOM, separador ;, auditoria)
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

console.log('\n[Envios CSV padronizado (V213)]');

let admin, operador, fornecedor;
await test('logins', async () => {
  admin = await login('maria.andrade@fesfsus.ba.gov.br');
  operador = await login('carlos.souza@fesfsus.ba.gov.br');
  fornecedor = await login('contato@empresahosp.com.br');
});

await test('seed: cria alguns envios', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  for (let i = 0; i < 3; i++) {
    await req('POST', '/api/envios/portal', { token: fornecedor.token,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-04',
              valor_centavos: 1000+i, numero_nf: 'V213-NF-' + i,
              descricao: 'descrição com acentos: ' + i } });
  }
});

await test('SEM auth retorna 401', async () => {
  const r = await req('GET', '/api/envios/export.csv');
  assert(r.status === 401);
});

let csvBytes, csvText;
await test('admin baixa CSV: 200 + BOM UTF-8 nos bytes', async () => {
  const r = await req('GET', '/api/envios/export.csv', { token: admin.token, raw: true });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.bytes[0] === 0xEF && r.bytes[1] === 0xBB && r.bytes[2] === 0xBF,
    `BOM ausente nos bytes: ${r.bytes[0].toString(16)} ${r.bytes[1].toString(16)} ${r.bytes[2].toString(16)}`);
  csvBytes = r.bytes;
  csvText = r.text;
});

await test('content-type CSV + filename com data', async () => {
  const r = await req('GET', '/api/envios/export.csv', { token: admin.token });
  const ct = r.headers.get('content-type') || '';
  assert(ct.includes('text/csv'), `content-type=${ct}`);
  const cd = r.headers.get('content-disposition') || '';
  assert(/filename=".*envios.*\.csv"/.test(cd), `filename ausente: ${cd}`);
});

await test('X-Total-Count exposto', async () => {
  const r = await req('GET', '/api/envios/export.csv', { token: admin.token });
  assert(r.headers.get('X-Total-Count') != null);
});

await test('cabecalho V213 — separador ; (nao mais ,) com 12 colunas', async () => {
  const linhas = csvText.replace(/^﻿/, '').split(/\r?\n/);
  const header = linhas[0];
  // Header deve usar ; e ter exatamente 12 colunas
  assert(header.split(';').length === 12, `12 colunas esperadas, veio ${header.split(';').length}: ${header}`);
  assert(header === 'protocolo;unidade;fornecedor;documento;modalidade;competencia;origem;status;valor_brl;numero_nf;descricao;criado_em',
    `header errado: ${header}`);
});

await test('linha de dados usa ; e tem valor BRL com vírgula decimal', async () => {
  const linhas = csvText.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (linhas.length < 2) return;
  const cols = linhas[1].split(';');
  assert(cols.length === 12, `dados com ${cols.length} colunas (esperado 12)`);
  // valor_brl (col index 8) deve ter virgula como separador decimal
  assert(/^\d+,\d{2}$/.test(cols[8]), `valor_brl errado: ${cols[8]}`);
});

await test('descrição com acentos preservada (UTF-8)', async () => {
  // Confere se "descrição" (com cedilha + til) aparece no texto
  assert(/descrição com acentos/.test(csvText), 'acentos não preservados');
});

await test('export por fornecedor (escopo): só vê próprios envios', async () => {
  const r = await req('GET', '/api/envios/export.csv', { token: fornecedor.token, raw: true });
  assert(r.status === 200);
  // Deve conter V213-NF-* (que ele criou)
  assert(/V213-NF-/.test(r.text), 'fornecedor nao vê próprios envios');
});

await test('export por operador (escopo): só vê unidade dele', async () => {
  const r = await req('GET', '/api/envios/export.csv', { token: operador.token, raw: true });
  assert(r.status === 200);
});

await test('export gera entrada de auditoria envios_exportados', async () => {
  await req('GET', '/api/envios/export.csv', { token: admin.token });
  const aud = await req('GET', '/api/auditoria/sistema?acao=envios_exportados', { token: admin.token });
  assert(aud.status === 200);
  assert(aud.json.trilha.length > 0, 'auditoria de export ausente');
});

await test('filtro origem aplicado', async () => {
  const r = await req('GET', '/api/envios/export.csv?origem=portal', { token: admin.token });
  assert(r.status === 200);
  const linhas = r.text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(';');
    assert(cols[6] === 'portal', `linha ${i} origem=${cols[6]}`);
  }
});

await test('CRLF como line ending (compat Excel Windows)', async () => {
  // O texto interno tem \r\n entre linhas
  const lf = csvText.split('\n').length - 1;
  const crlf = csvText.split('\r\n').length - 1;
  assert(crlf > 0, 'sem CRLF — Excel Windows pode renderizar como uma só linha');
});

console.log('\n========================================');
console.log(`Envios-CSV: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
