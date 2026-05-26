// =====================================================================
// V17: Bulk marcar-pago + aba pagamentos + resumo anotacoes
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

console.log('\n[V17 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V17 · Bulk marcar-pago]');

let ids = [];
await test('cria 3 envios e aprova todos', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  for (let i = 0; i < 3; i++) {
    const r = await req('POST', '/api/envios/portal', {
      token: tokenForn,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 1000 + i, numero_nf: 'BPG-' + i }
    });
    ids.push(r.json.envio.id);
    await req('POST', `/api/envios/${r.json.envio.id}/aprovar`, { token: tokenOp, body: {} });
  }
});

await test('admin marca 3 como pagos em lote', async () => {
  const r = await req('POST', '/api/envios/bulk/marcar-pago', {
    token: tokenAdmin, body: { ids, observacao: 'TED Lote 2026-05-24 · Banco do Brasil' }
  });
  assert(r.status === 200);
  assert(r.json.pagos.length === 3);
  assert(r.json.erros.length === 0);
});

await test('apos bulk, status dos 3 envios eh pago', async () => {
  for (const id of ids) {
    const r = await req('GET', `/api/envios/${id}`, { token: tokenAdmin });
    assert(r.json.envio.status === 'pago');
  }
});

await test('bulk com envio nao-aprovado retorna erro parcial', async () => {
  // cria um envio em em_analise
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r0 = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 99, numero_nf: 'EM-ANALISE' }
  });
  const r = await req('POST', '/api/envios/bulk/marcar-pago', {
    token: tokenAdmin, body: { ids: [r0.json.envio.id] }
  });
  assert(r.status === 200);
  assert(r.json.pagos.length === 0);
  assert(r.json.erros.length === 1);
  assert(r.json.erros[0].erro.includes('precisa estar aprovado'));
});

await test('operador NAO pode bulk-marcar-pago (403)', async () => {
  const r = await req('POST', '/api/envios/bulk/marcar-pago', {
    token: tokenOp, body: { ids: [ids[0]] }
  });
  assert(r.status === 403);
});

await test('fornecedor NAO pode bulk-marcar-pago (403)', async () => {
  const r = await req('POST', '/api/envios/bulk/marcar-pago', {
    token: tokenForn, body: { ids: [ids[0]] }
  });
  assert(r.status === 403);
});

await test('bulk sem ids retorna 400', async () => {
  const r = await req('POST', '/api/envios/bulk/marcar-pago', {
    token: tokenAdmin, body: { ids: [] }
  });
  assert(r.status === 400);
});

await test('bulk com >100 ids rejeita', async () => {
  const r = await req('POST', '/api/envios/bulk/marcar-pago', {
    token: tokenAdmin, body: { ids: Array.from({length:101}, (_,i)=>i+1) }
  });
  assert(r.status === 400);
});

await test('auditoria do bulk registra marcado_pago em cada', async () => {
  for (const id of ids) {
    const r = await req('GET', `/api/envios/${id}`, { token: tokenAdmin });
    const acao = r.json.auditoria.find(a => a.acao === 'marcado_pago');
    assert(acao, 'cada envio deve ter ' + 'marcado_pago' + ' na auditoria');
  }
});

await test('cada fornecedor recebe notificacao de pagamento', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenForn });
  const pagos = r.json.notificacoes.filter(n => ids.includes(n.entidade_id));
  assert(pagos.length >= 1, 'pelo menos 1 notificacao de pagamento');
});

// ============================================
console.log('\n[V17 · Pagina admin-pagamentos]');

await test('GET /app/admin-pagamentos.html retorna 200', async () => {
  const r = await fetch(`${BASE}/app/admin-pagamentos.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('Fila de pagamento'), 'titulo correto');
  assert(t.includes('marcarPagoLote'), 'usa marcarPagoLote');
  assert(t.includes('check-todos'), 'selecao multipla');
});

await test('admin.html linka para admin-pagamentos', async () => {
  const r = await fetch(`${BASE}/app/admin.html`);
  const t = await r.text();
  assert(t.includes('admin-pagamentos.html'), 'link presente');
});

// ============================================
console.log('\n[V17 · Resumo anotacoes no envio.html]');

await test('envio.html mostra contadores de verificados/duvidas/problemas', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('Verificados'), 'contador de verificados');
  assert(t.includes('Em dúvida'), 'contador de duvidas');
  assert(t.includes('Problemas'), 'contador de problemas');
  assert(t.includes('Não revisados'), 'contador de nao revisados');
});

await test('envio.html avisa quando ha problemas antes de aprovar', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('campo(s) marcado(s) como problema') || t.includes('como PROBLEMA'), 'aviso de problema na aprovacao');
});

console.log('\n========================================');
console.log(`V17: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
