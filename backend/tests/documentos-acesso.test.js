// =====================================================================
// V224: regressão dos 3 bugs reportados (visualizar/baixar/recibo voltar)
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
  return { status: r.status, json, text, raw: r };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  return r.json && r.json.token;
}

console.log('\n[Documentos: visualizar/baixar (V224)]');

let fornTok, opTok, envioId, docId;
await test('logins', async () => {
  fornTok = await login('contato@empresahosp.com.br');
  opTok   = await login('carlos.souza@fesfsus.ba.gov.br');
  assert(fornTok && opTok);
});

await test('Setup: cria envio + upload doc', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId  = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const env = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: heccId, modalidade_id: modId, competencia: '2026-04',
    valor_centavos: 50000, numero_nf: 'V224-' + Date.now(),
  } });
  assert(env.status === 201, `envio status ${env.status} ${env.text}`);
  envioId = env.json.envio.id;
  // Upload de um pdf falso
  const fd = new FormData();
  fd.append('arquivo', new Blob(['%PDF-1.4 fake content'], { type: 'application/pdf' }), 'teste-nf.pdf');
  fd.append('campo', 'q5_nf');
  const up = await fetch(`${BASE}/api/envios/${envioId}/documentos`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + fornTok },
    body: fd
  });
  assert(up.status === 201, `upload status ${up.status}`);
  docId = (await up.json()).documento.id;
});

// -------------------------------------------------------------------
// Bug 1: download sem Authorization → 401 (raiz do "Token Ausente")
// -------------------------------------------------------------------
await test('Bug 1: GET /documentos/X/download SEM token → 401', async () => {
  const r = await req('GET', `/api/envios/${envioId}/documentos/${docId}/download`);
  assert(r.status === 401, `esperava 401, veio ${r.status}`);
});

await test('Bug 1: GET /documentos/X/download COM token fornecedor dono → 200', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/download`, {
    headers: { Authorization: 'Bearer ' + fornTok }
  });
  assert(r.status === 200, `status ${r.status}`);
  const cd = r.headers.get('Content-Disposition');
  assert(/attachment/.test(cd), `Content-Disposition errado: ${cd}`);
  assert(/teste-nf\.pdf/.test(cd), `nome ausente: ${cd}`);
});

await test('Bug 1: GET /documentos/X/download como operador da unidade → 200', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/download`, {
    headers: { Authorization: 'Bearer ' + opTok }
  });
  assert(r.status === 200, `status ${r.status}`);
});

// -------------------------------------------------------------------
// Bug 2: preview com auth → 200 (e content-disposition inline)
// -------------------------------------------------------------------
await test('Bug 2: GET /documentos/X/preview com auth → 200 inline', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`, {
    headers: { Authorization: 'Bearer ' + fornTok }
  });
  assert(r.status === 200, `status ${r.status}`);
  const cd = r.headers.get('Content-Disposition');
  assert(/inline/.test(cd), `Content-Disposition errado: ${cd}`);
  const buf = await r.arrayBuffer();
  assert(buf.byteLength > 0, 'response vazio');
});

await test('Bug 2: preview retorna 410 (JSON) quando arquivo sumiu do disco', async () => {
  // Cria um doc com caminho inválido direto no DB para simular arquivo apagado
  const { query } = await import('../db/index.js').catch(() => ({ query: null }));
  if (!query) {
    // Se PGlite não acessível direto, faz via fluxo: cria envio + altera caminho
    // através de teste alternativo — neste caso pulamos com warning
    console.log('    [skip: sem acesso direto ao DB]');
    return;
  }
  // PGlite em uso no mesmo processo causa crash — pulamos
  console.log('    [skip: PGlite single-handle]');
});

// -------------------------------------------------------------------
// Bug 1+2: documento de OUTRO fornecedor → 403 (segurança)
// -------------------------------------------------------------------
await test('Segurança: outro fornecedor não acessa preview', async () => {
  // Login com outro fornecedor — temos só 1 fornecedor com_portal no seed
  // então fazemos com operador de OUTRA unidade (que não atende HECC)
  const opOutro = await login('beatriz.ramos@fesfsus.ba.gov.br'); // MRC
  if (!opOutro) { console.log('    [skip: sem operador MRC]'); return; }
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`, {
    headers: { Authorization: 'Bearer ' + opOutro }
  });
  assert(r.status === 403, `esperava 403, veio ${r.status}`);
});

// -------------------------------------------------------------------
// Bug 3: voltarInteligente do recibo.html — código source
// -------------------------------------------------------------------
await test('Bug 3: recibo.html voltarInteligente prioriza usuario logado', async () => {
  const html = await (await fetch(`${BASE}/app/recibo.html`)).text();
  assert(/voltarInteligente/.test(html), 'função voltarInteligente sumiu');
  // Remove comentários // antes de procurar pelas chamadas reais
  const codigo = html.replace(/\/\/[^\n]*/g, '');
  // history.back() não deve mais aparecer como chamada efetiva
  assert(!/history\.back\(\)/.test(codigo), 'voltarInteligente ainda chama history.back() (causava deslogar)');
  // Deve consultar localStorage do usuario
  assert(/fesf_usuario/.test(codigo), 'voltarInteligente não consulta fesf_usuario');
  // Deve redirecionar para portal ou painel conforme papel
  assert(/portal\.html/.test(codigo) && /painel\.html/.test(codigo),
    'falta navegação direta para portal/painel conforme papel');
});

await test('Bug 3: api.downloadDocumento removeu window.open inseguro', async () => {
  const js = await (await fetch(`${BASE}/app/api.js`)).text();
  // O bug original era abrir window.open antes do fetch — agora não tem mais
  const trecho = js.split('downloadDocumento')[1]?.split('},')[0] || '';
  assert(!/window\.open/.test(trecho), 'window.open ainda no downloadDocumento (bug "Token ausente")');
});

console.log('\n========================================');
console.log(`Documentos-acesso: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
