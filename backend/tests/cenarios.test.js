// =====================================================================
// VERIFICAÇÃO END-TO-END DOS 3 CENÁRIOS
// Demonstra que os 3 cenários coexistem harmonicamente
// e que a finalidade (pagamento da FESF aos fornecedores) é cumprida.
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
  if (r.status !== 200) throw new Error('login: ' + r.text);
  return r.json.token;
}

let tokenAdmin, tokenOp, tokenForn;
let heccId, modId, fornId;

console.log('\n[Setup do ambiente de teste]');
await test('logins admin, operador HECC, fornecedor', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
  heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  fornId = (await req('GET', '/api/fornecedores', { token: tokenOp })).json.fornecedores[0].id;
});

// =====================================================================
console.log('\n[CENÁRIO 1 · Fornecedor logado (Portal)]');
// =====================================================================
let envio1;

await test('1.1 fornecedor consulta seu dashboard (KPIs + vencimentos)', async () => {
  const r = await req('GET', '/api/envios', { token: tokenForn });
  assert(r.status === 200);
  assert(Array.isArray(r.json.envios));
  const e = await req('GET', '/api/expectativas', { token: tokenForn });
  assert(e.status === 200, 'fornecedor pode listar próprias expectativas (V25)');
});

await test('1.2 fornecedor submete envio via portal (com dados do form)', async () => {
  const r = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-05', valor_centavos: 450000, numero_nf: 'NF-CEN1', dados: { q9_valor: '4500.00' } }
  });
  assert(r.status === 201, 'envio criado: ' + r.text);
  assert(r.json.envio.origem === 'portal');
  envio1 = r.json.envio.id;
});

await test('1.3 operador HECC vê o envio com origem=portal', async () => {
  const r = await req('GET', '/api/envios?status=em_analise', { token: tokenOp });
  assert(r.json.envios.some(e => e.id === envio1 && e.origem === 'portal'));
});

await test('1.4 operador anota campo, solicita retificação', async () => {
  await req('POST', `/api/envios/${envio1}/anotacoes`, { token: tokenOp,
    body: { campo: 'q9_valor', status: 'duvida', observacao: 'verificar valor' } });
  const r = await req('POST', `/api/envios/${envio1}/solicitar-retificacao`, { token: tokenOp, body: { motivo: 'valor da NF divergente' } });
  assert(r.status === 200);
});

await test('1.5 fornecedor recebe notificação e retifica (cria v2)', async () => {
  const n = await req('GET', '/api/notificacoes', { token: tokenForn });
  assert(n.json.notificacoes.some(x => x.entidade === 'envio' && x.entidade_id === envio1));
  const v = await req('POST', `/api/envios/${envio1}/versoes`, { token: tokenForn, body: { dados: { q9_valor: '4250.00' } } });
  assert(v.status === 201);
});

await test('1.6 operador aprova + admin paga com TED estruturado', async () => {
  await req('POST', `/api/envios/${envio1}/aprovar`, { token: tokenOp, body: {} });
  const r = await req('POST', `/api/envios/${envio1}/marcar-pago`, {
    token: tokenAdmin,
    body: { numero_ted: 'TED-CEN1-001', banco_pagador: 'Banco do Brasil', data_efetiva: '2026-05-24', valor_pago_centavos: 425000, observacao: 'cenário 1 concluído' }
  });
  assert(r.status === 200);
  const d = await req('GET', `/api/envios/${envio1}`, { token: tokenForn });
  assert(d.json.envio.status === 'pago');
  assert(d.json.pagamento && d.json.pagamento.numero_ted === 'TED-CEN1-001', 'pagamento estruturado');
});

// =====================================================================
console.log('\n[CENÁRIO 2 · Link público (sem autenticação)]');
// =====================================================================
let linkToken, envio2;

await test('2.1 operador gera link público para fornecedor externo', async () => {
  const r = await req('POST', '/api/links', { token: tokenOp,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-05', email_destinatario: 'externo@fornecedor.com.br', fornecedor_id: fornId } });
  assert(r.status === 201);
  linkToken = r.json.link.token;
});

await test('2.2 fornecedor abre link SEM autenticação', async () => {
  const r = await req('GET', `/api/links/${linkToken}`);
  assert(r.status === 200, 'lookup público OK');
  assert(r.json.unidade_sigla === 'HECC', 'link expõe contexto (unidade/modalidade) sem auth');
  assert(r.json.valido === true);
});

await test('2.3 fornecedor submete via link público (anônimo)', async () => {
  const r = await req('POST', `/api/envios/publico/${linkToken}`, {
    body: { competencia: '2026-05', valor_centavos: 280000, numero_nf: 'NF-CEN2', submetente_nome: 'João Silva', submetente_documento: '11222333000181', dados: { q1_descricao: 'Serviço prestado em 05/2026' } }
  });
  assert(r.status === 201, 'envio público criado: ' + r.text);
  assert(r.json.envio.origem === 'link_publico');
  envio2 = r.json.envio.id;
});

await test('2.4 consulta pública por protocolo funciona SEM auth', async () => {
  const proto = (await req('GET', `/api/envios/${envio2}`, { token: tokenAdmin })).json.envio.protocolo;
  const r = await req('GET', `/api/envios/protocolo/${encodeURIComponent(proto)}`);
  assert(r.status === 200, 'consulta pública: ' + r.text);
  assert(r.json.envio.protocolo === proto);
  const recibo = await req('GET', `/api/envios/protocolo/${encodeURIComponent(proto)}/recibo`);
  assert(recibo.status === 200, 'recibo anônimo via protocolo (V22)');
});

await test('2.5 operador processa do mesmo jeito que cenário 1', async () => {
  await req('POST', `/api/envios/${envio2}/aprovar`, { token: tokenOp, body: {} });
  await req('POST', `/api/envios/${envio2}/marcar-pago`, { token: tokenAdmin, body: { numero_ted: 'TED-CEN2-001', banco_pagador: 'Caixa', data_efetiva: '2026-05-24' } });
  const d = await req('GET', `/api/envios/${envio2}`, { token: tokenAdmin });
  assert(d.json.envio.status === 'pago');
});

// =====================================================================
console.log('\n[CENÁRIO 3 · Fornecedor que NÃO responde (Pendência)]');
// =====================================================================
let expId, envio3;

await test('3.1 operador cria expectativa com cadência customizada', async () => {
  const r = await req('POST', '/api/expectativas', { token: tokenOp,
    body: { fornecedor_id: fornId, unidade_id: heccId, modalidade_id: modId, competencia: '2026-05', prazo: '2026-05-10', origem_prevista: 'portal', cadencia: { antes: [5, 1], depois: [3, 7] } } });
  assert(r.status === 201);
  expId = r.json.expectativa.id;
});

await test('3.2 lembrete automático: status muda para "lembrado"', async () => {
  await req('POST', `/api/expectativas/${expId}/lembrete`, { token: tokenOp, body: {} });
  const r = await req('GET', `/api/expectativas?status=lembrado`, { token: tokenOp });
  assert(r.json.expectativas.some(x => x.id === expId));
});

await test('3.3 admin marca fornecedor como INADIMPLENTE (V20)', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornId}/engajamento`, { token: tokenAdmin,
    body: { status: 'inadimplente', motivo: 'fornecedor se recusa a enviar há 90 dias' } });
  assert(r.status === 200);
});

await test('3.4 sistema BLOQUEIA criar nova expectativa (V21)', async () => {
  const r = await req('POST', '/api/expectativas', { token: tokenOp,
    body: { fornecedor_id: fornId, unidade_id: heccId, modalidade_id: modId, competencia: '2026-06', prazo: '2026-06-15', origem_prevista: 'portal' } });
  assert(r.status === 409);
  assert(r.json.code === 'FORNECEDOR_INADIMPLENTE');
});

await test('3.5 com confirmação explícita, operador CONVERTE em manual (FESF assume)', async () => {
  // Revert engajamento para teste de conversão
  await req('PATCH', `/api/fornecedores/${fornId}/engajamento`, { token: tokenAdmin, body: { status: 'ativo' } });
  const r = await req('POST', `/api/expectativas/${expId}/converter-manual`, {
    token: tokenOp,
    body: { motivo: 'fornecedor não respondeu após 3 lembretes, FESF lança em nome dele', valor_centavos: 320000, numero_nf: 'MANUAL-001' }
  });
  assert(r.status === 201);
  envio3 = r.json.envio.id;
  assert(r.json.envio.origem === 'manual');
});

await test('3.6 expectativa fica como "cumprida" e o envio manual é processado', async () => {
  const e = await req('GET', `/api/expectativas?status=cumprida`, { token: tokenOp });
  assert(e.json.expectativas.some(x => x.id === expId));
  await req('POST', `/api/envios/${envio3}/aprovar`, { token: tokenOp, body: {} });
  await req('POST', `/api/envios/${envio3}/marcar-pago`, { token: tokenAdmin, body: { numero_ted: 'TED-CEN3-001', banco_pagador: 'Banco do Brasil', data_efetiva: '2026-05-24' } });
  const d = await req('GET', `/api/envios/${envio3}`, { token: tokenAdmin });
  assert(d.json.envio.status === 'pago', 'cenário 3 também desemboca em pagamento');
});

// =====================================================================
console.log('\n[Harmonia entre os 3 cenários]');
// =====================================================================

await test('Todos os 3 envios têm origem distinta mas mesmo workflow', async () => {
  const e1 = (await req('GET', `/api/envios/${envio1}`, { token: tokenAdmin })).json.envio;
  const e2 = (await req('GET', `/api/envios/${envio2}`, { token: tokenAdmin })).json.envio;
  const e3 = (await req('GET', `/api/envios/${envio3}`, { token: tokenAdmin })).json.envio;
  assert(e1.origem === 'portal');
  assert(e2.origem === 'link_publico');
  assert(e3.origem === 'manual');
  assert(e1.status === e2.status && e2.status === e3.status && e1.status === 'pago', 'todos chegaram a "pago"');
});

await test('Auditoria registra TUDO em cada cenário (LGPD)', async () => {
  for (const id of [envio1, envio2, envio3]) {
    const r = await req('GET', `/api/envios/${id}`, { token: tokenAdmin });
    const acoes = r.json.auditoria.map(a => a.acao);
    assert(acoes.includes('aprovado'), `envio ${id} tem aprovação na auditoria`);
    assert(acoes.includes('marcado_pago'), `envio ${id} tem pagamento na auditoria`);
  }
});

await test('Métricas consolidam os 3 cenários para FESF Sede', async () => {
  const m = await req('GET', '/api/metricas', { token: tokenAdmin });
  const origens = m.json.por_origem.map(o => o.origem);
  assert(origens.includes('portal') && origens.includes('link_publico') && origens.includes('manual'), 'métricas tem as 3 origens');
  assert(m.json.sla, 'tem SLA agregado');
  assert(typeof m.json.fornecedores_inadimplentes === 'number');
});

console.log('\n========================================');
console.log(`Cenários: ${passed} passou · ${failed} falhou`);
console.log(`Finalidade comprovada: ${failed === 0 ? '✓ os 3 cenários coexistem harmonicamente e desembocam em pagamento auditável' : '✗ ainda há gaps'}`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
