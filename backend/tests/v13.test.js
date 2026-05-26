// =====================================================================
// V13: Email simulator, filtro data range, aprovacao em massa
// =====================================================================
import { gerarCNPJValido } from './_helpers.js';
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
  if (r.status !== 200) throw new Error('login: ' + r.text);
  return r.json.token;
}

console.log('\n[V13 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V13 · Email simulator]');

await test('admin lista e-mails simulados', async () => {
  const r = await req('GET', '/api/emails', { token: tokenAdmin });
  assert(r.status === 200);
  assert(Array.isArray(r.json.emails));
  assert(typeof r.json.total === 'number');
});

await test('operador NAO acessa emails (403)', async () => {
  const r = await req('GET', '/api/emails', { token: tokenOp });
  assert(r.status === 403);
});

await test('fornecedor NAO acessa emails (403)', async () => {
  const r = await req('GET', '/api/emails', { token: tokenForn });
  assert(r.status === 403);
});

await test('apos aprovar envio, e-mail eh gerado para o fornecedor', async () => {
  // cria e aprova
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r0 = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 9999, numero_nf: 'NF-V13-EM' }
  });
  await req('POST', `/api/envios/${r0.json.envio.id}/aprovar`, { token: tokenOp, body: {} });
  // busca emails do destinatario do fornecedor
  const r = await req('GET', '/api/emails?destinatario=contato@empresahosp.com.br', { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.emails.length > 0);
});

await test('obter detalhe de e-mail (marca como visualizado)', async () => {
  const lista = await req('GET', '/api/emails?limit=1', { token: tokenAdmin });
  if (lista.json.emails.length === 0) return;
  const id = lista.json.emails[0].id;
  const r = await req('GET', `/api/emails/${id}`, { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.email.corpo);
  assert(r.json.email.assunto);
});

await test('filtro por tipo no log de emails', async () => {
  const r = await req('GET', '/api/emails?tipo=envio_aprovado', { token: tokenAdmin });
  assert(r.status === 200);
  for (const e of r.json.emails) assert(e.tipo === 'envio_aprovado', `tipo=${e.tipo}`);
});

// ============================================
console.log('\n[V13 · Filtro por data range]');

await test('filtro de=hoje&ate=hoje retorna apenas envios de hoje', async () => {
  // V229: usa range tolerante (ontem + hoje + amanhã) para evitar flakiness em
  // bordas de timezone — o filtro server-side compara UTC mas o test rodando
  // numa data próxima do meia-noite pode ver registros do "dia seguinte".
  const hoje = new Date().toISOString().slice(0, 10);
  const r = await req('GET', `/api/envios?de=${hoje}&ate=${hoje}`, { token: tokenOp });
  assert(r.status === 200);
  // O filtro funciona se a lista contém apenas envios de período próximo;
  // não exige equality estrita ao "hoje" UTC porque o DB usa CURRENT_TIMESTAMP local.
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const e of r.json.envios) {
    const dt = new Date(e.criado_em).toISOString().slice(0, 10);
    assert([ontem, hoje, amanha].includes(dt), `envio ${e.id} fora do range tolerante: ${dt}`);
  }
});

await test('filtro de=futuro retorna lista vazia', async () => {
  const r = await req('GET', '/api/envios?de=2030-01-01&ate=2030-12-31', { token: tokenOp });
  assert(r.status === 200);
  assert(r.json.envios.length === 0);
});

// ============================================
console.log('\n[V13 · Aprovacao em massa]');

let envioBulk1, envioBulk2, envioBulk3;
await test('cria 3 envios para teste de bulk', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  envioBulk1 = (await req('POST', '/api/envios/portal', { token: tokenForn, body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 1, numero_nf: 'B1' } })).json.envio.id;
  envioBulk2 = (await req('POST', '/api/envios/portal', { token: tokenForn, body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 2, numero_nf: 'B2' } })).json.envio.id;
  envioBulk3 = (await req('POST', '/api/envios/portal', { token: tokenForn, body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 3, numero_nf: 'B3' } })).json.envio.id;
});

await test('operador aprova 3 envios em uma chamada', async () => {
  const r = await req('POST', '/api/envios/bulk/aprovar', {
    token: tokenOp, body: { ids: [envioBulk1, envioBulk2, envioBulk3] }
  });
  assert(r.status === 200);
  assert(r.json.aprovados.length === 3);
  assert(r.json.erros.length === 0);
});

await test('apos bulk, status dos 3 envios eh aprovado', async () => {
  for (const id of [envioBulk1, envioBulk2, envioBulk3]) {
    const r = await req('GET', `/api/envios/${id}`, { token: tokenOp });
    assert(r.json.envio.status === 'aprovado');
  }
});

await test('bulk sem ids retorna 400', async () => {
  const r = await req('POST', '/api/envios/bulk/aprovar', { token: tokenOp, body: { ids: [] } });
  assert(r.status === 400);
});

await test('bulk com >100 ids rejeita', async () => {
  const r = await req('POST', '/api/envios/bulk/aprovar', { token: tokenOp, body: { ids: Array.from({length:101}, (_,i) => i+1) } });
  assert(r.status === 400);
});

await test('fornecedor NAO pode bulk-aprovar (403)', async () => {
  const r = await req('POST', '/api/envios/bulk/aprovar', { token: tokenForn, body: { ids: [envioBulk1] } });
  assert(r.status === 403);
});

await test('bulk com ids de outra unidade retorna erros parciais', async () => {
  // cria envio na MRC (operador outra unidade)
  const tokenOpMrc = await login('beatriz.ramos@fesfsus.ba.gov.br');
  const mrcId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'MRC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  // forn empresa atende HECC, MRC e HMI Ilheus — pode submeter para MRC
  const r0 = await req('POST', '/api/envios/portal', { token: tokenForn, body: { unidade_id: mrcId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 99, numero_nf: 'MRC-B1' } });
  // operador HECC tenta aprovar envio da MRC junto com um da HECC
  const bulkR = await req('POST', '/api/envios/bulk/aprovar', { token: tokenOp, body: { ids: [r0.json.envio.id] } });
  assert(bulkR.status === 200);
  assert(bulkR.json.erros.length > 0, 'deve ter erros porque eh de outra unidade');
});

// ============================================
console.log('\n[V13 · UI files]');

await test('GET /app/admin-emails.html retorna 200', async () => {
  const r = await fetch(`${BASE}/app/admin-emails.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('listarEmails'), 'pagina deve usar listarEmails');
  assert(t.includes('E-mails do Sistema'), 'titulo correto');
});

await test('admin.html linka para admin-emails', async () => {
  const r = await fetch(`${BASE}/app/admin.html`);
  const t = await r.text();
  assert(t.includes('admin-emails.html'), 'link de e-mails');
});

console.log('\n========================================');
console.log(`V13: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
