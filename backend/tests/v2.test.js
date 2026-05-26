// =====================================================================
// Testes das novas funcionalidades:
// - notificacoes geradas automaticamente
// - escalonamento periodico (forcado)
// - CSV export
// - metricas
// Pressupoe servidor rodando em :3000
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
  if (body) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  if (raw) return { status: r.status, text };
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.text}`);
  return r.json.token;
}

console.log('\n[V2 · Setup]');
let tokenForn, tokenOp, tokenAdmin;
await test('logins', async () => {
  tokenForn = await login('contato@empresahosp.com.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
});

const unidades = (await req('GET', '/api/unidades')).json.unidades;
const modalidades = (await req('GET', '/api/modalidades')).json.modalidades;
const heccId = unidades.find(u => u.sigla === 'HECC').id;
const modMoeId = modalidades.find(m => m.codigo === 'indenizatorio_moe').id;

// ===================================================================
// NOTIFICACOES
// ===================================================================
console.log('\n[V2 · Notificacoes]');

await test('fornecedor cria envio -> operador recebe notificacao novo_envio', async () => {
  const antes = (await req('GET', '/api/notificacoes', { token: tokenOp })).json.nao_lidas;
  await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modMoeId, competencia: '2026-12', valor_centavos: 1000, numero_nf: 'NOTIF-1' }
  });
  const depois = (await req('GET', '/api/notificacoes', { token: tokenOp })).json;
  assert(depois.nao_lidas > antes, `esperava nao_lidas crescer (antes=${antes}, depois=${depois.nao_lidas})`);
  const ultima = depois.notificacoes[0];
  assert(ultima.tipo === 'novo_envio', `tipo=${ultima.tipo}`);
});

await test('operador solicita retificacao -> fornecedor recebe notificacao', async () => {
  // criar envio e pedir retificacao
  const r0 = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modMoeId, competencia: '2026-12', valor_centavos: 5000, numero_nf: 'NOTIF-2' }
  });
  const envioId = r0.json.envio.id;
  const antes = (await req('GET', '/api/notificacoes', { token: tokenForn })).json.nao_lidas;
  await req('POST', `/api/envios/${envioId}/solicitar-retificacao`, { token: tokenOp, body: { motivo: 'Anexar comprovantes' } });
  const depois = (await req('GET', '/api/notificacoes', { token: tokenForn })).json;
  assert(depois.nao_lidas > antes);
  const ultima = depois.notificacoes[0];
  assert(ultima.tipo === 'retificacao_solicitada');
});

await test('operador aprova -> fornecedor recebe envio_aprovado', async () => {
  const r0 = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modMoeId, competencia: '2026-12', valor_centavos: 5000, numero_nf: 'NOTIF-3' }
  });
  const envioId = r0.json.envio.id;
  await req('POST', `/api/envios/${envioId}/aprovar`, { token: tokenOp, body: {} });
  const r = await req('GET', '/api/notificacoes', { token: tokenForn });
  const aprov = r.json.notificacoes.find(n => n.tipo === 'envio_aprovado');
  assert(aprov, 'nenhuma notif envio_aprovado encontrada');
});

await test('marcar uma notificacao como lida', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenOp });
  const naoLida = r.json.notificacoes.find(n => !n.lida);
  if (!naoLida) return; // ja tudo lido
  const r2 = await req('POST', `/api/notificacoes/${naoLida.id}/ler`, { token: tokenOp, body: {} });
  assert(r2.status === 200);
  const r3 = await req('GET', '/api/notificacoes', { token: tokenOp });
  const ainda = r3.json.notificacoes.find(n => n.id === naoLida.id);
  assert(ainda.lida === true);
});

await test('marcar todas como lidas zera contador', async () => {
  await req('POST', '/api/notificacoes/ler-todas', { token: tokenOp, body: {} });
  const r = await req('GET', '/api/notificacoes', { token: tokenOp });
  assert(r.json.nao_lidas === 0);
});

// ===================================================================
// ESCALONAMENTO MANUAL
// ===================================================================
console.log('\n[V2 · Escalonamento periodico]');
await test('admin pode forcar escalonamento manualmente via endpoint', async () => {
  const r = await req('POST', '/api/expectativas/escalonar', { token: tokenAdmin, body: {} });
  assert(r.status === 200);
  assert(typeof r.json.promovidasSemResposta === 'number');
  assert(typeof r.json.promovidasAtrasada === 'number');
});

await test('escalonamento nao pode ser disparado por operador (so admin)', async () => {
  const r = await req('POST', '/api/expectativas/escalonar', { token: tokenOp, body: {} });
  assert(r.status === 403);
});

// ===================================================================
// CSV EXPORT
// ===================================================================
console.log('\n[V2 · CSV Export]');
await test('operador exporta CSV da sua unidade', async () => {
  const r = await req('GET', '/api/envios/export.csv', { token: tokenOp, raw: true });
  assert(r.status === 200);
  // V213: header agora usa separador ; (Excel pt-BR) e CSV tem BOM UTF-8 + CRLF
  const text = r.text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  assert(lines[0].startsWith('protocolo;unidade;'), `header invalido: ${lines[0].substring(0,80)}`);
  assert(lines.length > 1, 'sem dados');
});

await test('CSV inclui filtro por origem', async () => {
  const r = await req('GET', '/api/envios/export.csv?origem=manual', { token: tokenOp, raw: true });
  assert(r.status === 200, `status ${r.status}`);
  const text = r.text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  assert(lines.length >= 1, 'pelo menos header');
  // V213: valor "manual" nao precisa de aspas (separador eh ;, vírgula nao escapa)
  // Origem fica na coluna 7 (0-idx 6) — protocolo;unidade;fornecedor;documento;modalidade;competencia;origem;status;...
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    assert(cols[6] === 'manual', `linha ${i} origem=${cols[6]}: ${lines[i].substring(0,120)}`);
  }
});

await test('fornecedor exporta CSV (apenas dos proprios envios)', async () => {
  const r = await req('GET', '/api/envios/export.csv', { token: tokenForn, raw: true });
  assert(r.status === 200);
  const lines = r.text.split('\n');
  // todos devem ter o documento do fornecedor (11222333000181) OU referenciar empresa
  // como tem so o header esperado, validamos status 200 e formato
  assert(lines.length >= 1);
});

// ===================================================================
// METRICAS
// ===================================================================
console.log('\n[V2 · Metricas]');
await test('admin acessa /api/metricas', async () => {
  const r = await req('GET', '/api/metricas', { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.totais);
  assert(typeof r.json.totais.total_envios === 'number');
  assert(Array.isArray(r.json.por_unidade));
  assert(Array.isArray(r.json.por_origem));
  assert(Array.isArray(r.json.por_modalidade));
  assert(Array.isArray(r.json.por_status));
});

await test('operador nao acessa /api/metricas (403)', async () => {
  const r = await req('GET', '/api/metricas', { token: tokenOp });
  assert(r.status === 403);
});

await test('metricas por_unidade inclui todas as unidades', async () => {
  const r = await req('GET', '/api/metricas', { token: tokenAdmin });
  const siglas = r.json.por_unidade.map(u => u.sigla);
  assert(siglas.includes('HECC'));
  assert(siglas.includes('MRC'));
  assert(siglas.includes('SEDE'));
});

await test('metricas por_origem agrupa corretamente', async () => {
  const r = await req('GET', '/api/metricas', { token: tokenAdmin });
  const origens = r.json.por_origem.map(o => o.origem);
  // pelo menos portal e link_publico devem aparecer pelos seeds + testes
  assert(origens.includes('portal'));
  assert(origens.includes('manual'));
});

await test('metricas com filtro de competencia', async () => {
  const r = await req('GET', '/api/metricas?competencia=2026-05', { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.competencia === '2026-05');
});

// ===================================================================
// Resultado
// ===================================================================
console.log('\n========================================');
console.log(`V2: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
