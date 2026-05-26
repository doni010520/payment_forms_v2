// =====================================================================
// V18: Perfil + Notificacoes + Fornecedores list + Anotacoes documento
//      + Encaminhar para FESF Sede + Revogar link publico
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

console.log('\n[V18 · Setup]');
let tokenAdmin, tokenOp, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

// ============================================
console.log('\n[V18 · Perfil GET/PATCH]');

await test('GET /api/me retorna usuario com unidade/fornecedor populados', async () => {
  const r = await req('GET', '/api/me', { token: tokenOp });
  assert(r.status === 200);
  assert(r.json.usuario.papel === 'operador_unidade');
  assert(r.json.usuario.unidade_sigla, 'tem unidade');
});

await test('GET /api/me do fornecedor traz fornecedor_razao_social', async () => {
  const r = await req('GET', '/api/me', { token: tokenForn });
  assert(r.status === 200);
  assert(r.json.usuario.papel === 'fornecedor');
  assert(r.json.usuario.fornecedor_razao_social, 'tem fornecedor');
});

await test('PATCH /api/me atualiza nome', async () => {
  const r = await req('PATCH', '/api/me', { token: tokenAdmin, body: { nome: 'Maria Andrade (FESF Sede)' } });
  assert(r.status === 200);
  assert(r.json.ok === true);
});

await test('PATCH /api/me rejeita nome curto', async () => {
  const r = await req('PATCH', '/api/me', { token: tokenAdmin, body: { nome: 'X' } });
  assert(r.status === 400);
});

await test('GET /api/me sem token = 401', async () => {
  const r = await req('GET', '/api/me', {});
  assert(r.status === 401);
});

// ============================================
console.log('\n[V18 · Anotacoes em documentos]');

let envioComDoc, docId;
await test('cria envio com documento para anotar', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V18-DOC' } });
  envioComDoc = r.json.envio.id;
  // upload doc via multipart
  const fd = new FormData();
  const blob = new Blob(['conteudo teste'], { type: 'text/plain' });
  fd.append('arquivo', blob, 'recibo.pdf');
  fd.append('campo', 'doc_nota');
  const r2 = await fetch(`${BASE}/api/envios/${envioComDoc}/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenForn}` }, body: fd,
  });
  assert(r2.status === 201, 'upload doc');
  const j = await r2.json();
  docId = j.documento.id;
});

await test('operador anota documento como verificado', async () => {
  const r = await req('POST', `/api/envios/${envioComDoc}/documentos/${docId}/anotacao`, {
    token: tokenOp, body: { status: 'verificado', observacao: 'OK' }
  });
  assert(r.status === 201);
});

await test('GET envio inclui anotacoes_documento', async () => {
  const r = await req('GET', `/api/envios/${envioComDoc}`, { token: tokenOp });
  assert(r.status === 200);
  assert(Array.isArray(r.json.anotacoes_documento));
  assert(r.json.anotacoes_documento.length === 1, 'tem 1 anotacao doc');
  assert(r.json.anotacoes_documento[0].status === 'verificado');
});

await test('reanotacao no mesmo doc faz UPSERT (1 linha)', async () => {
  await req('POST', `/api/envios/${envioComDoc}/documentos/${docId}/anotacao`, {
    token: tokenOp, body: { status: 'problema', observacao: 'rasura' }
  });
  const r = await req('GET', `/api/envios/${envioComDoc}`, { token: tokenOp });
  assert(r.json.anotacoes_documento.length === 1, 'ainda 1');
  assert(r.json.anotacoes_documento[0].status === 'problema');
});

await test('fornecedor NAO ve anotacoes_documento', async () => {
  const r = await req('GET', `/api/envios/${envioComDoc}`, { token: tokenForn });
  assert(r.status === 200);
  assert(Array.isArray(r.json.anotacoes_documento));
  assert(r.json.anotacoes_documento.length === 0, 'fornecedor ve lista vazia');
});

await test('fornecedor NAO pode anotar doc (403)', async () => {
  const r = await req('POST', `/api/envios/${envioComDoc}/documentos/${docId}/anotacao`, {
    token: tokenForn, body: { status: 'verificado' }
  });
  assert(r.status === 403);
});

await test('status invalido rejeitado (400)', async () => {
  const r = await req('POST', `/api/envios/${envioComDoc}/documentos/${docId}/anotacao`, {
    token: tokenOp, body: { status: 'xxx' }
  });
  assert(r.status === 400);
});

// ============================================
console.log('\n[V18 · Encaminhar para FESF Sede]');

let envioEnc;
await test('cria envio em_analise para encaminhar', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V18-ENC' } });
  envioEnc = r.json.envio.id;
});

await test('operador encaminha para FESF Sede', async () => {
  const r = await req('POST', `/api/envios/${envioEnc}/encaminhar-sede`, {
    token: tokenOp, body: { motivo: 'documento suspeito de fraude' }
  });
  assert(r.status === 200);
  assert(r.json.admins_notificados >= 1);
});

await test('encaminhamento gera auditoria', async () => {
  const r = await req('GET', `/api/envios/${envioEnc}`, { token: tokenOp });
  const acao = r.json.auditoria.find(a => a.acao === 'encaminhado_sede');
  assert(acao, 'tem acao encaminhado_sede');
});

await test('encaminhamento gera comentario na thread', async () => {
  const r = await req('GET', `/api/envios/${envioEnc}`, { token: tokenOp });
  const com = r.json.comentarios.find(c => c.texto.includes('Encaminhado para FESF Sede'));
  assert(com, 'tem comentario');
});

await test('admin recebe notificacao do encaminhamento', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenAdmin });
  const n = r.json.notificacoes.find(x => x.entidade === 'envio' && x.entidade_id === envioEnc);
  assert(n, 'admin notificado');
});

await test('motivo curto rejeitado (400)', async () => {
  const r = await req('POST', `/api/envios/${envioEnc}/encaminhar-sede`, {
    token: tokenOp, body: { motivo: 'oi' }
  });
  assert(r.status === 400);
});

await test('admin NAO pode encaminhar (so operador unidade)', async () => {
  const r = await req('POST', `/api/envios/${envioEnc}/encaminhar-sede`, {
    token: tokenAdmin, body: { motivo: 'tentativa' }
  });
  assert(r.status === 403);
});

// ============================================
console.log('\n[V18 · Revogar link publico]');

await test('operador cria e depois revoga link', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/links', { token: tokenOp,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-08', email_destinatario: 'rev@ex.com' } });
  assert(r.status === 201);
  const id = r.json.link.id;
  const r2 = await req('DELETE', `/api/links/${id}`, { token: tokenOp });
  assert(r2.status === 200);
  // verifica que aparece revogado na lista
  const r3 = await req('GET', `/api/links/unidade/${heccId}`, { token: tokenOp });
  const link = r3.json.links.find(l => l.id === id);
  assert(link.revogado === true || link.revogado === 1, 'link aparece revogado');
});

// ============================================
console.log('\n[V18 · Paginas frontend]');

await test('GET /app/perfil.html retorna 200', async () => {
  const r = await fetch(`${BASE}/app/perfil.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('Trocar senha'));
  assert(t.includes('Preferências de notificação'));
  assert(t.includes('atualizarMeuPerfil'));
});

await test('GET /app/notificacoes.html retorna 200', async () => {
  const r = await fetch(`${BASE}/app/notificacoes.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('Central de notificações'));
  assert(t.includes('marcarTodas'));
  assert(t.includes('filtro-chip'));
});

await test('GET /app/admin-fornecedores.html retorna 200', async () => {
  const r = await fetch(`${BASE}/app/admin-fornecedores.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('tipo-chip'), 'usa pill de tipo');
  assert(t.includes('admin-fornecedor.html?id='));
});

await test('envio.html tem botoes de anotacao de documento', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('data-anot-doc'), 'tem data-anot-doc');
  assert(t.includes('anotarDocumento'));
});

await test('envio.html tem acao Encaminhar para FESF Sede', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('Encaminhar para FESF Sede'));
  assert(t.includes('encaminharSede') || t.includes('encaminhar-sede'));
});

await test('painel.html tem botao Revogar nos links', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('data-revoga') || t.includes('revogarLink'));
});

await test('admin.html linka para admin-fornecedores e perfil', async () => {
  const r = await fetch(`${BASE}/app/admin.html`);
  const t = await r.text();
  assert(t.includes('admin-fornecedores.html'));
  assert(t.includes('perfil.html'));
});

await test('admin.html linka para notificacoes.html', async () => {
  const r = await fetch(`${BASE}/app/admin.html`);
  const t = await r.text();
  assert(t.includes('notificacoes.html'));
});

console.log('\n========================================');
console.log(`V18: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
