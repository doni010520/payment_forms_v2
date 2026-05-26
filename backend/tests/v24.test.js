// =====================================================================
// V24: Multi-unit operator, bulk cancelar pendencias, side-by-side
//      preview, auto-refresh envios
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
  return { token: r.json.token, usuario: r.json.usuario };
}

console.log('\n[V24 · Setup]');
let tokenAdmin, tokenOp, opUsuario, tokenForn;
await test('logins', async () => {
  tokenAdmin = (await login('maria.andrade@fesfsus.ba.gov.br')).token;
  const lo = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenOp = lo.token; opUsuario = lo.usuario;
  tokenForn = (await login('contato@empresahosp.com.br')).token;
});

// ============================================
console.log('\n[V24 · Multi-unit operator]');

let mrcId;
await test('admin adiciona MRC como unidade extra do operador HECC', async () => {
  const uns = (await req('GET', '/api/unidades')).json.unidades;
  mrcId = uns.find(u => u.sigla === 'MRC').id;
  const r = await req('POST', `/api/usuarios/${opUsuario.id}/unidades`, {
    token: tokenAdmin, body: { unidade_id: mrcId }
  });
  assert(r.status === 201);
});

await test('GET /api/usuarios/:id/unidades retorna primaria + extras', async () => {
  const r = await req('GET', `/api/usuarios/${opUsuario.id}/unidades`, { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.primaria);
  assert(r.json.primaria.sigla === 'HECC');
  assert(Array.isArray(r.json.extras));
  assert(r.json.extras.some(e => e.sigla === 'MRC'));
});

await test('operador agora vê envios de HECC E MRC na listagem', async () => {
  // cria envio em HECC e em MRC
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V24-H' } });
  await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: mrcId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V24-M' } });
  const r = await req('GET', '/api/envios', { token: tokenOp });
  assert(r.status === 200);
  const siglas = new Set(r.json.envios.map(e => e.unidade_sigla));
  assert(siglas.has('HECC'), 'lista contem HECC');
  assert(siglas.has('MRC'), 'lista agora contem MRC (extra)');
});

await test('operador agora pode mudar status de envio em MRC (extra)', async () => {
  // pega envio recem-criado em MRC
  const r = await req('GET', '/api/envios', { token: tokenOp });
  const envioMrc = r.json.envios.find(e => e.unidade_sigla === 'MRC' && e.status === 'em_analise');
  assert(envioMrc, 'achou envio MRC em analise');
  const apr = await req('POST', `/api/envios/${envioMrc.id}/aprovar`, { token: tokenOp, body: {} });
  assert(apr.status === 200, 'operador aprovou via extra: ' + apr.text);
});

await test('duplicada da mesma unidade retorna 409', async () => {
  const r = await req('POST', `/api/usuarios/${opUsuario.id}/unidades`, {
    token: tokenAdmin, body: { unidade_id: mrcId }
  });
  assert(r.status === 409);
});

await test('adicionar a unidade primaria como extra retorna 400', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const r = await req('POST', `/api/usuarios/${opUsuario.id}/unidades`, {
    token: tokenAdmin, body: { unidade_id: heccId }
  });
  assert(r.status === 400);
});

await test('admin remove MRC e operador perde acesso', async () => {
  const r = await req('DELETE', `/api/usuarios/${opUsuario.id}/unidades/${mrcId}`, { token: tokenAdmin });
  assert(r.status === 200);
  const r2 = await req('GET', '/api/envios', { token: tokenOp });
  const siglas = new Set(r2.json.envios.map(e => e.unidade_sigla));
  assert(!siglas.has('MRC'), 'lista nao tem mais MRC');
});

await test('fornecedor nao pode mudar unidades de operador (403)', async () => {
  const r = await req('POST', `/api/usuarios/${opUsuario.id}/unidades`, {
    token: tokenForn, body: { unidade_id: mrcId }
  });
  assert(r.status === 403);
});

// ============================================
console.log('\n[V24 · Bulk cancelar pendencias]');

let bulkExpIds = [];
await test('cria 3 expectativas e cancela em lote', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const fornId = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores[0].id;
  for (let i = 0; i < 3; i++) {
    const r = await req('POST', '/api/expectativas', {
      token: tokenOp,
      body: { fornecedor_id: fornId, unidade_id: heccId, modalidade_id: modId, competencia: '2026-' + String(10 + i).padStart(2, '0'), prazo: '2026-12-15', origem_prevista: 'portal', forcar_inadimplente: true }
    });
    bulkExpIds.push(r.json.expectativa.id);
  }
  const r = await req('POST', '/api/expectativas/bulk/cancelar', {
    token: tokenOp, body: { ids: bulkExpIds, motivo: 'limpeza de pendencias antigas' }
  });
  assert(r.status === 200);
  assert(r.json.canceladas.length === 3);
});

await test('bulk cancelar sem motivo retorna 400', async () => {
  const r = await req('POST', '/api/expectativas/bulk/cancelar', {
    token: tokenOp, body: { ids: [1], motivo: 'x' }
  });
  assert(r.status === 400);
});

await test('bulk cancelar sem ids retorna 400', async () => {
  const r = await req('POST', '/api/expectativas/bulk/cancelar', {
    token: tokenOp, body: { ids: [], motivo: 'motivo valido' }
  });
  assert(r.status === 400);
});

// ============================================
console.log('\n[V24 · UI]');

await test('envio.html tem toggle split preview', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('toggle-split') || t.includes('toggleSplit'));
  assert(t.includes('Comparar com formulário'));
  assert(t.includes('prev-form'));
});

await test('painel.html tem bulk cancelar antigas', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('bulk-cancelar') || t.includes('Cancelar antigas'));
  assert(t.includes('cancelarMultiplas'));
});

await test('painel.html tem auto-refresh envios', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('Auto-refresh') || (t.includes('setInterval') && t.includes('carregarEnvios()')));
});

console.log('\n========================================');
console.log(`V24: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
