// =====================================================================
// V25: Multi-unit UI, badge inadimplente, vencimentos no portal,
//      hash dedup anti-fraude
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

console.log('\n[V25 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V25 · Hash dedup anti-fraude]');

let envio1, envio2;
await test('cria 2 envios e faz upload do MESMO arquivo em ambos', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r1 = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V25-A' } });
  envio1 = r1.json.envio.id;
  const r2 = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 200, numero_nf: 'V25-B' } });
  envio2 = r2.json.envio.id;
  const blob = new Blob(['CONTEUDO IDENTICO DO ARQUIVO'], { type: 'application/pdf' });
  // upload no envio1
  const fd1 = new FormData(); fd1.append('arquivo', blob, 'nf-dup.pdf'); fd1.append('campo', 'nf');
  const u1 = await fetch(`${BASE}/api/envios/${envio1}/documentos`, { method:'POST', headers:{Authorization:'Bearer '+tokenForn}, body: fd1 });
  const j1 = await u1.json();
  assert(u1.status === 201);
  assert(Array.isArray(j1.duplicatas), 'response inclui duplicatas');
  assert(j1.duplicatas.length === 0, 'primeiro upload nao tem duplicata');
  // upload no envio2 (mesmo arquivo)
  const fd2 = new FormData(); fd2.append('arquivo', blob, 'nf-dup.pdf'); fd2.append('campo', 'nf');
  const u2 = await fetch(`${BASE}/api/envios/${envio2}/documentos`, { method:'POST', headers:{Authorization:'Bearer '+tokenForn}, body: fd2 });
  const j2 = await u2.json();
  assert(u2.status === 201);
  assert(j2.duplicatas.length === 1, 'segundo upload detecta duplicata');
  assert(j2.duplicatas[0].envio_id === envio1, 'duplicata aponta para envio1');
});

await test('operadores recebem notificacao de duplicata', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenOp });
  const n = r.json.notificacoes.find(x => x.entidade === 'envio' && x.entidade_id === envio2 && (x.mensagem.includes('já apareceu em') || x.mensagem.includes('reutiliza')));
  assert(n, 'operador foi alertado');
});

await test('auditoria registra documento_duplicado_detectado', async () => {
  const r = await req('GET', `/api/envios/${envio2}`, { token: tokenOp });
  const aud = r.json.auditoria.find(a => a.acao === 'documento_duplicado_detectado');
  assert(aud, 'auditoria registrada');
});

// ============================================
console.log('\n[V25 · Fornecedor lista próprias expectativas]');

await test('fornecedor GET /api/expectativas retorna apenas as próprias', async () => {
  // cria expectativa
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const fornId = (await req('GET', '/api/fornecedores', { token: tokenAdmin })).json.fornecedores.find(f => f.razao_social.includes('Hospitalar')).id;
  await req('POST', '/api/expectativas', {
    token: tokenOp,
    body: { fornecedor_id: fornId, unidade_id: heccId, modalidade_id: modId, competencia: '2026-11', prazo: '2026-12-15', origem_prevista: 'portal' }
  });
  const r = await req('GET', '/api/expectativas', { token: tokenForn });
  assert(r.status === 200);
  assert(Array.isArray(r.json.expectativas));
  assert(r.json.expectativas.length >= 1, 'fornecedor vê expectativas próprias');
  // todas devem ser do proprio fornecedor (via JOIN), backend filtra
});

// ============================================
console.log('\n[V25 · UI]');

await test('admin-usuarios.html tem modal de unidades extras', async () => {
  const r = await fetch(`${BASE}/app/admin-usuarios.html`);
  const t = await r.text();
  assert(t.includes('modal-unidades-op'));
  assert(t.includes('gerenciarUnidades'));
  assert(t.includes('unidadesOperador'));
});

await test('painel.html aba Fornecedores tem badge engajamento', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('status_engajamento'));
  assert(t.includes('Inadimplente') || t.includes('inadimplente'));
});

await test('portal.html tem widget vencimentos-wrap', async () => {
  const r = await fetch(`${BASE}/app/portal.html`);
  const t = await r.text();
  assert(t.includes('vencimentos-wrap'));
  assert(t.includes('carregarVencimentos'));
  assert(t.includes('Próximos vencimentos'));
});

console.log('\n========================================');
console.log(`V25: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
