// =====================================================================
// V14: Respostas do form no detalhe + pagina sucesso rica
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

console.log('\n[V14 · Setup]');
let tokenForn, tokenOp, envioId;
await test('logins', async () => {
  tokenForn = await login('contato@empresahosp.com.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
});

await test('cria envio com dados completos do form', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: {
      unidade_id: heccId, modalidade_id: modId,
      competencia: '2026-12', valor_centavos: 12345600, numero_nf: 'NF-V14-001',
      descricao: 'Servico de limpeza Mai/2026',
      dados: {
        q1_nomeFornecedor: 'Empresa Hospitalar Ltda.',
        q2_cnpj: '11.222.333/0001-81',
        q3_valor: '123.456,00',
        q4_descricao: 'Limpeza hospitalar das alas A e B',
        q10_nfNumero: 'NF-V14-001',
        q5_competencia: '2026-12',
        q6_dataEmissaoNF: '2026-05-15',
        q7_responsavelTecnico: 'Ana Costa',
        q8_observacoes: 'Nenhuma',
      }
    }
  });
  assert(r.status === 201);
  envioId = r.json.envio.id;
});

// ============================================
console.log('\n[V14 · Detalhe inclui form_data parseado]');

await test('GET /api/envios/:id retorna form_data', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenForn });
  assert(r.status === 200);
  assert(r.json.form_data, 'form_data deve estar presente');
  assert(r.json.form_data.q1_nomeFornecedor === 'Empresa Hospitalar Ltda.');
  assert(r.json.form_data.q4_descricao === 'Limpeza hospitalar das alas A e B');
});

await test('operador HECC tambem ve form_data', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenOp });
  assert(r.status === 200);
  assert(r.json.form_data.q1_nomeFornecedor === 'Empresa Hospitalar Ltda.');
  assert(r.json.form_data.q10_nfNumero === 'NF-V14-001');
});

await test('versoes inclui dados_json', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenForn });
  assert(r.json.versoes.length >= 1);
  const v = r.json.versoes[0];
  assert(v.dados_json, 'dados_json deve estar presente em versoes');
});

// ============================================
console.log('\n[V14 · Pagina sucesso.html]');

await test('GET /app/sucesso.html retorna 200', async () => {
  const r = await fetch(`${BASE}/app/sucesso.html`);
  assert(r.status === 200);
  const t = await r.text();
  assert(t.includes('Envio recebido com sucesso'), 'titulo correto');
  assert(t.includes('protocolo-block'), 'estilo do protocolo');
  assert(t.includes('Próximos passos'), 'secao proximos passos');
  assert(t.includes('Acompanhar no portal'), 'botao portal');
});

await test('sucesso.html usa formatarRespostasForm', async () => {
  const r = await fetch(`${BASE}/app/sucesso.html`);
  const t = await r.text();
  assert(t.includes('formatarRespostasForm'), 'deve usar helper');
});

// ============================================
console.log('\n[V14 · Helper formatarRespostasForm em api.js]');

await test('api.js expoe formatarRespostasForm', async () => {
  const r = await fetch(`${BASE}/app/api.js`);
  const t = await r.text();
  assert(t.includes('formatarRespostasForm'), 'export presente');
  assert(t.includes('q1_nomeFornecedor'), 'labels presentes');
});

// ============================================
console.log('\n[V14 · Forms incluem form-adapter atualizado]');

await test('form-adapter.js redireciona para sucesso.html', async () => {
  const r = await fetch(`${BASE}/app/form-adapter.js`);
  const t = await r.text();
  assert(t.includes('/app/sucesso.html'), 'deve redirecionar para sucesso');
});

await test('formulario-hcc.html ainda inclui o adapter', async () => {
  const r = await fetch(`${BASE}/formulario-hcc.html`);
  const t = await r.text();
  assert(t.includes('form-adapter.js'), 'adapter incluido');
});

// ============================================
console.log('\n[V14 · UIs apresentam form_data]');

await test('portal.html mostra "Respostas do formulario"', async () => {
  const r = await fetch(`${BASE}/app/portal.html`);
  const t = await r.text();
  assert(t.includes('Respostas do formulário') || t.includes('Respostas do formul'), 'titulo nao encontrado');
  assert(t.includes('formatarRespostasForm'), 'helper nao usado');
});

await test('painel.html mostra "Respostas do formulario"', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('Respostas do formul'), 'titulo nao encontrado');
  assert(t.includes('formatarRespostasForm'), 'helper nao usado');
});

await test('recibo.html mostra "Respostas do formulario"', async () => {
  const r = await fetch(`${BASE}/app/recibo.html`);
  const t = await r.text();
  assert(t.includes('Respostas do formul'), 'titulo nao encontrado');
});

console.log('\n========================================');
console.log(`V14: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
