// =====================================================================
// V15: Pagina envio.html standalone + preview inline de documentos
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

console.log('\n[V15 · Setup]');
let tokenForn, tokenOp, tokenAdmin, tokenOpMrc, envioId, docId;
await test('logins', async () => {
  tokenForn = await login('contato@empresahosp.com.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOpMrc = await login('beatriz.ramos@fesfsus.ba.gov.br');
});

await test('cria envio + anexa doc para teste', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r0 = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 99999, numero_nf: 'V15' }
  });
  envioId = r0.json.envio.id;
  // upload
  const fd = new FormData();
  fd.append('arquivo', new Blob(['conteudo do PDF teste V15'], { type: 'application/pdf' }), 'teste-v15.pdf');
  fd.append('campo', 'nf_pdf');
  const up = await fetch(`${BASE}/api/envios/${envioId}/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenForn}` }, body: fd
  });
  assert(up.status === 201);
  const det = await req('GET', `/api/envios/${envioId}`, { token: tokenForn });
  docId = det.json.documentos[0].id;
});

// ============================================
console.log('\n[V15 · Preview inline de documento]');

await test('GET preview retorna 200 com Content-Disposition inline', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`, {
    headers: { Authorization: `Bearer ${tokenForn}` }
  });
  assert(r.status === 200);
  const cd = r.headers.get('Content-Disposition') || '';
  assert(cd.startsWith('inline'), `Content-Disposition deveria ser inline, foi: ${cd}`);
  assert(r.headers.get('Content-Type') === 'application/pdf', `mime esperado pdf, obteve ${r.headers.get('Content-Type')}`);
});

await test('preview retorna conteudo do arquivo', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`, {
    headers: { Authorization: `Bearer ${tokenForn}` }
  });
  const txt = await r.text();
  assert(txt === 'conteudo do PDF teste V15');
});

await test('operador HECC pode preview', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`, {
    headers: { Authorization: `Bearer ${tokenOp}` }
  });
  assert(r.status === 200);
});

await test('operador outra unidade NAO pode preview (403)', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`, {
    headers: { Authorization: `Bearer ${tokenOpMrc}` }
  });
  assert(r.status === 403);
});

await test('admin pode preview', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`, {
    headers: { Authorization: `Bearer ${tokenAdmin}` }
  });
  assert(r.status === 200);
});

await test('preview sem token retorna 401', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`);
  assert(r.status === 401);
});

await test('docId inexistente retorna 404', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/99999/preview`, {
    headers: { Authorization: `Bearer ${tokenForn}` }
  });
  assert(r.status === 404);
});

// ============================================
console.log('\n[V15 · Pagina /app/envio.html]');

await test('GET /app/envio.html retorna 200', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('Análise de envio'), 'titulo correto');
  assert(t.includes('detail-header'), 'estilo detail-header');
  assert(t.includes('timeline-wrap'), 'wrapper de timeline');
  assert(t.includes('detail-tabs'), 'abas internas');
});

await test('envio.html usa 5 abas: resumo/formulario/documentos/comentarios/auditoria', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('data-tab="resumo"'));
  assert(t.includes('data-tab="formulario"'));
  assert(t.includes('data-tab="documentos"'));
  assert(t.includes('data-tab="comentarios"'));
  assert(t.includes('data-tab="auditoria"'));
});

await test('envio.html tem botao Visualizar (preview)', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('Visualizar') || t.includes('visualizar'));
});

await test('painel.html agora linka para /app/envio.html', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('/app/envio.html'), 'painel deve linkar para envio.html');
});

await test('portal.html agora linka para /app/envio.html', async () => {
  const r = await fetch(`${BASE}/app/portal.html`);
  const t = await r.text();
  assert(t.includes('/app/envio.html'), 'portal deve linkar para envio.html');
});

console.log('\n========================================');
console.log(`V15: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
