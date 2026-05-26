// =====================================================================
// V23: Audit filters avancados, comentarios fornecedor rollup,
//      mobile CSS, a11y publico, print relatorio
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

console.log('\n[V23 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V23 · Audit log filtros avancados]');

await test('GET /api/auditoria/sistema com filtro desde/ate', async () => {
  const r = await req('GET', `/api/auditoria/sistema?desde=2020-01-01&ate=2099-01-01&limit=10`, { token: tokenAdmin });
  assert(r.status === 200);
  assert(Array.isArray(r.json.trilha));
});

await test('GET /api/auditoria/sistema com filtro q (busca texto)', async () => {
  // cria um envio para gerar auditoria
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V23-AUD' } });
  // busca por substring "Andrade" no nome do usuario
  const r = await req('GET', `/api/auditoria/sistema?q=andrade&limit=10`, { token: tokenAdmin });
  assert(r.status === 200);
  // pode ou nao retornar resultados (depende dos seeds), apenas valida que nao quebra
  assert(Array.isArray(r.json.trilha));
});

await test('GET /api/auditoria/sistema com filtro usuario_id', async () => {
  const lu = await req('GET', '/api/usuarios', { token: tokenAdmin });
  const usuarioId = lu.json.usuarios[0].id;
  const r = await req('GET', `/api/auditoria/sistema?usuario_id=${usuarioId}&limit=10`, { token: tokenAdmin });
  assert(r.status === 200);
});

// ============================================
console.log('\n[V23 · Comentarios fornecedor rollup]');

let envioId, fornId;
await test('cria envio e comentario do fornecedor', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V23-C' } });
  envioId = r.json.envio.id;
  fornId = r.json.envio.fornecedor_id;
  await req('POST', `/api/envios/${envioId}/comentarios`, { token: tokenForn, body: { texto: 'comentário V23 do fornecedor' } });
});

await test('GET /api/fornecedores/:id/detalhe agora retorna comentarios', async () => {
  const r = await req('GET', `/api/fornecedores/${fornId}/detalhe`, { token: tokenAdmin });
  assert(r.status === 200);
  assert(Array.isArray(r.json.comentarios), 'tem campo comentarios');
  const meu = r.json.comentarios.find(c => c.texto.includes('V23'));
  assert(meu, 'comentario aparece no rollup');
  assert(meu.protocolo, 'rollup inclui protocolo do envio');
});

// ============================================
console.log('\n[V23 · UI]');

await test('admin-auditoria.html tem inputs desde/ate/q/usuario', async () => {
  const r = await fetch(`${BASE}/app/admin-auditoria.html`);
  const t = await r.text();
  assert(t.includes('f-desde'));
  assert(t.includes('f-ate'));
  assert(t.includes('f-q'));
  assert(t.includes('f-usuario'));
});

await test('admin-fornecedor.html mostra comentarios do fornecedor', async () => {
  const r = await fetch(`${BASE}/app/admin-fornecedor.html`);
  const t = await r.text();
  assert(t.includes('Comentários recentes do fornecedor') || t.includes('comentarios'));
});

await test('style.css tem @media mobile e :focus-visible', async () => {
  const r = await fetch(`${BASE}/app/style.css`);
  const t = await r.text();
  assert(t.includes('@media (max-width: 768px)'));
  assert(t.includes(':focus-visible'));
  assert(t.includes('.skip-link'));
});

await test('publico.html tem skip-link e roles ARIA', async () => {
  const r = await fetch(`${BASE}/app/publico.html`);
  const t = await r.text();
  assert(t.includes('skip-link'));
  assert(t.includes('role="main"') || t.includes('role=\'main\''));
  assert(t.includes('aria-live') || t.includes('aria-labelledby'));
});

await test('relatorio-print.html existe e usa SLA + por_unidade', async () => {
  const r = await fetch(`${BASE}/app/relatorio-print.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('por-unidade'));
  assert(t.includes('SLA'));
  assert(t.includes('window.print') || t.includes('window.print()'));
});

await test('admin-relatorios.html tem botão Imprimir', async () => {
  const r = await fetch(`${BASE}/app/admin-relatorios.html`);
  const t = await r.text();
  assert(t.includes('imprimir') || t.includes('Imprimir / PDF'));
  assert(t.includes('relatorio-print.html'));
});

console.log('\n========================================');
console.log(`V23: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
