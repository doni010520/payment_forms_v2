// =====================================================================
// V16: Anotacoes por campo + form por secoes + documentos com tipo visual
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

console.log('\n[V16 · Setup]');
let tokenForn, tokenOp, tokenOpMrc, tokenAdmin, envioId;
await test('logins', async () => {
  tokenForn = await login('contato@empresahosp.com.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenOpMrc = await login('beatriz.ramos@fesfsus.ba.gov.br');
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
});

await test('cria envio com varios campos do form', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: {
      unidade_id: heccId, modalidade_id: modId, competencia: '2026-12',
      valor_centavos: 12345600, numero_nf: 'NF-V16',
      dados: {
        q1_nomeFornecedor: 'Empresa V16',
        q2_cnpj: '11.222.333/0001-81',
        q3_valor: '123.456,00',
        q10_nfNumero: 'NF-V16',
        q11_dataEmissao: '2026-05-01',
        q15_certidaoFederal: 'OK',
        q22_compInss: 'INSS Mai/2026',
      }
    }
  });
  envioId = r.json.envio.id;
});

// ============================================
console.log('\n[V16 · Anotacoes por campo (operador)]');

await test('operador anota campo como verificado', async () => {
  const r = await req('POST', `/api/envios/${envioId}/anotacoes`, {
    token: tokenOp, body: { campo: 'q1_nomeFornecedor', status: 'verificado' }
  });
  assert(r.status === 201);
});

await test('operador anota campo como problema com observacao', async () => {
  const r = await req('POST', `/api/envios/${envioId}/anotacoes`, {
    token: tokenOp, body: { campo: 'q22_compInss', status: 'problema', observacao: 'Comprovante INSS ilegivel - solicitar reenvio' }
  });
  assert(r.status === 201);
});

await test('GET /api/envios/:id agora inclui anotacoes', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenOp });
  assert(r.status === 200);
  assert(Array.isArray(r.json.anotacoes), 'anotacoes deve ser array');
  assert(r.json.anotacoes.length === 2);
  const inss = r.json.anotacoes.find(a => a.campo === 'q22_compInss');
  assert(inss && inss.status === 'problema');
  assert(inss.observacao.includes('ilegivel'));
});

await test('UPDATE anotacao existente (upsert por campo)', async () => {
  // mesma operador muda status do mesmo campo
  const r = await req('POST', `/api/envios/${envioId}/anotacoes`, {
    token: tokenOp, body: { campo: 'q1_nomeFornecedor', status: 'duvida', observacao: 'verificar razao social no CNPJ' }
  });
  assert(r.status === 201);
  const r2 = await req('GET', `/api/envios/${envioId}`, { token: tokenOp });
  const ano = r2.json.anotacoes.find(a => a.campo === 'q1_nomeFornecedor');
  assert(ano.status === 'duvida', 'status deveria ter mudado para duvida');
  assert(ano.observacao.includes('verificar'));
});

await test('status invalido rejeita 400', async () => {
  const r = await req('POST', `/api/envios/${envioId}/anotacoes`, {
    token: tokenOp, body: { campo: 'q5', status: 'magico' }
  });
  assert(r.status === 400);
});

await test('campo vazio rejeita 400', async () => {
  const r = await req('POST', `/api/envios/${envioId}/anotacoes`, {
    token: tokenOp, body: { campo: '', status: 'verificado' }
  });
  assert(r.status === 400);
});

await test('operador outra unidade NAO pode anotar (403)', async () => {
  const r = await req('POST', `/api/envios/${envioId}/anotacoes`, {
    token: tokenOpMrc, body: { campo: 'q1_nomeFornecedor', status: 'verificado' }
  });
  assert(r.status === 403);
});

await test('fornecedor NAO pode anotar (403)', async () => {
  const r = await req('POST', `/api/envios/${envioId}/anotacoes`, {
    token: tokenForn, body: { campo: 'q1_nomeFornecedor', status: 'verificado' }
  });
  assert(r.status === 403);
});

await test('fornecedor NAO ve anotacoes no detalhe (privacidade)', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenForn });
  assert(r.status === 200);
  // fornecedor recebe array vazio
  assert(Array.isArray(r.json.anotacoes) && r.json.anotacoes.length === 0, 'fornecedor nao deve ver anotacoes do operador');
});

await test('admin acessa anotacoes', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenAdmin });
  assert(r.json.anotacoes.length >= 2);
});

await test('auditoria registra campo_anotado', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenAdmin });
  const acao = r.json.auditoria.find(a => a.acao === 'campo_anotado');
  assert(acao, 'auditoria deve registrar campo_anotado');
});

// ============================================
console.log('\n[V16 · UI atualizada]');

await test('api.js expoe formatarRespostasFormSecoes', async () => {
  const r = await fetch(`${BASE}/app/api.js`);
  const t = await r.text();
  assert(t.includes('formatarRespostasFormSecoes'), 'helper de secoes deve existir');
  assert(t.includes('SECOES_FORM'), 'mapa de secoes deve existir');
  assert(t.includes('Dados Gerais do Serviço e do Fornecedor'), 'titulo da secao 1');
  assert(t.includes('Nota Fiscal e Documentação da Empresa'), 'titulo da secao 2');
});

await test('envio.html usa formatarRespostasFormSecoes', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('formatarRespostasFormSecoes'), 'usa helper de secoes');
  assert(t.includes('anotarCampo') || t.includes('data-anotar'), 'tem mecanismo de anotacao');
});

await test('envio.html tem badges de tipo de documento', async () => {
  const r = await fetch(`${BASE}/app/envio.html`);
  const t = await r.text();
  assert(t.includes('tipoCores'), 'mapa de cores por tipo de arquivo');
});

console.log('\n========================================');
console.log(`V16: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
