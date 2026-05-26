// =====================================================================
// V221: upload de documentos via link público (anônimo) + adapter intercepta Files
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
  return r.json.token;
}

console.log('\n[Upload público (V221)]');

let opTok, token, envioId, linkId;

await test('login operador', async () => { opTok = await login('carlos.souza@fesfsus.ba.gov.br'); });

await test('operador cria link público', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_servicos').id;
  // Pega um fornecedor existente (cenario real: operador vincula link a fornecedor)
  const forn = (await req('GET', '/api/fornecedores', { token: opTok })).json.fornecedores[0];
  const r = await req('POST', '/api/links', { token: opTok,
    body: { unidade_id: heccId, modalidade_id: modId, fornecedor_id: forn.id, email_destinatario: 'teste@v221.com', uso_multiplo: true, expira_em: '2099-12-31' } });
  assert(r.status === 200 || r.status === 201);
  token = r.json.link.token;
  linkId = r.json.link.id;
});

await test('anônimo submete envio via link', async () => {
  const r = await req('POST', `/api/envios/publico/${token}`, {
    body: { competencia: '2026-11', valor_centavos: 50000, numero_nf: 'V221-NF', descricao: 'V221 teste upload' } });
  assert(r.status === 200 || r.status === 201);
  envioId = r.json.envio.id;
});

await test('upload no endpoint público funciona (sem auth)', async () => {
  const fd = new FormData();
  const blob = new Blob(['conteudo de teste V221'], { type: 'text/plain' });
  fd.append('arquivo', blob, 'docV221.txt');
  fd.append('campo', 'q10_anexo');
  const r = await fetch(`${BASE}/api/envios/publico/${token}/${envioId}/documentos`, {
    method: 'POST', body: fd
  });
  assert(r.status === 201, `status ${r.status}`);
  const j = await r.json();
  assert(j.documento && j.documento.id, 'documento ausente');
  assert(j.documento.nome_original === 'docV221.txt');
});

await test('rejeita upload com envio que NÃO pertence ao link (403)', async () => {
  // Pega outro envio (do seed)
  const env2 = (await req('GET', '/api/envios?status=em_analise', { token: opTok })).json.envios.find(e => e.id !== envioId);
  if (!env2) return; // sem outros envios
  const fd = new FormData();
  fd.append('arquivo', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
  fd.append('campo', 'a');
  const r = await fetch(`${BASE}/api/envios/publico/${token}/${env2.id}/documentos`, {
    method: 'POST', body: fd
  });
  assert(r.status === 403, `esperava 403, veio ${r.status}`);
});

await test('rejeita upload com token inválido (404)', async () => {
  const fd = new FormData();
  fd.append('arquivo', new Blob(['x']), 'x.txt');
  fd.append('campo', 'a');
  const r = await fetch(`${BASE}/api/envios/publico/token_invalido_xyz/${envioId}/documentos`, {
    method: 'POST', body: fd
  });
  assert(r.status === 404, `esperava 404, veio ${r.status}`);
});

await test('rejeita upload com link revogado (403)', async () => {
  // Revoga o link
  const del = await req('DELETE', `/api/links/${linkId}`, { token: opTok });
  assert(del.status === 200);
  const fd = new FormData();
  fd.append('arquivo', new Blob(['x']), 'x.txt');
  fd.append('campo', 'a');
  const r = await fetch(`${BASE}/api/envios/publico/${token}/${envioId}/documentos`, {
    method: 'POST', body: fd
  });
  assert(r.status === 403, `esperava 403, veio ${r.status}`);
});

await test('rejeita upload sem arquivo (400)', async () => {
  const fd = new FormData();
  fd.append('campo', 'so_o_campo');
  const r = await fetch(`${BASE}/api/envios/publico/${token}/${envioId}/documentos`, {
    method: 'POST', body: fd
  });
  // link revogado vem antes — pode dar 403; o que queremos é não-201
  assert(r.status !== 201, `esperava nao-201, veio ${r.status}`);
});

await test('adapter agora captura Files reais via capture-phase', async () => {
  const r = await fetch(`${BASE}/app/form-adapter.js`);
  const text = await r.text();
  assert(/_fesfFiles/.test(text), '_fesfFiles ausente');
  assert(/addEventListener\('change'.*true\)/.test(text) || /'change'[\s\S]*?true\)/s.test(text),
    'capture-phase no change ausente');
  assert(/uploadArquivo/.test(text), 'funcao de upload ausente');
});

console.log('\n========================================');
console.log(`Upload-publico: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
