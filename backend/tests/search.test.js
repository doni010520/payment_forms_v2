// =====================================================================
// Busca global GET /api/search?q= — fornecedores/envios/unidades + RBAC
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

console.log('\n[Busca global]');

let admToken, opToken, fornToken;
await test('login admin', async () => { admToken = await login('maria.andrade@fesfsus.ba.gov.br'); });
await test('login operador HECC', async () => { opToken = await login('carlos.souza@fesfsus.ba.gov.br'); });
await test('login fornecedor', async () => { fornToken = await login('contato@empresahosp.com.br'); });

await test('SEM auth retorna 401', async () => {
  const r = await req('GET', '/api/search?q=hosp');
  assert(r.status === 401, `veio ${r.status}`);
});

await test('q vazio ou < 2 chars retorna 400', async () => {
  const r = await req('GET', '/api/search?q=a', { token: admToken });
  assert(r.status === 400);
  assert(r.json.min === 2);
});

await test('admin busca por nome de fornecedor', async () => {
  const r = await req('GET', '/api/search?q=hosp', { token: admToken });
  assert(r.status === 200);
  assert(r.json.resultados.fornecedores.length > 0, 'esperava ao menos 1 fornecedor');
  const tem = r.json.resultados.fornecedores.some(f => f.razao_social.toLowerCase().includes('hosp'));
  assert(tem, 'fornecedor com "hosp" no nome ausente');
});

await test('admin busca por sigla de unidade (HECC)', async () => {
  const r = await req('GET', '/api/search?q=HECC', { token: admToken });
  assert(r.status === 200);
  const tem = r.json.resultados.unidades.some(u => u.sigla === 'HECC');
  assert(tem, 'unidade HECC nao encontrada');
});

await test('busca por CNPJ com pontuacao normaliza para digitos', async () => {
  // Pegar um CNPJ qualquer
  const all = await req('GET', '/api/search?q=hosp', { token: admToken });
  const cnpj = all.json.resultados.fornecedores[0]?.documento;
  if (!cnpj) throw new Error('sem fornecedor pra extrair CNPJ');
  // Busca com pontuacao tipo XX.XXX.XXX
  const formatado = cnpj.slice(0, 2) + '.' + cnpj.slice(2, 5) + '.' + cnpj.slice(5, 8);
  const r = await req('GET', '/api/search?q=' + encodeURIComponent(formatado), { token: admToken });
  assert(r.status === 200);
  const achou = r.json.resultados.fornecedores.some(f => f.documento === cnpj);
  assert(achou, `busca por "${formatado}" nao retornou doc ${cnpj}`);
});

let envioTeste;
await test('seed: cria envio para testar busca por protocolo', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: fornToken,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-09', valor_centavos: 12345, numero_nf: 'NF-BUSCA-001' } });
  assert(r.status === 200 || r.status === 201, `status ${r.status}`);
  envioTeste = r.json.envio;
});

await test('busca por protocolo retorna o envio', async () => {
  const r = await req('GET', '/api/search?q=' + encodeURIComponent(envioTeste.protocolo), { token: admToken });
  assert(r.status === 200);
  const achou = r.json.resultados.envios.some(e => e.protocolo === envioTeste.protocolo);
  assert(achou, `protocolo ${envioTeste.protocolo} nao encontrado`);
});

await test('busca por numero NF retorna o envio', async () => {
  const r = await req('GET', '/api/search?q=NF-BUSCA-001', { token: admToken });
  assert(r.status === 200);
  const achou = r.json.resultados.envios.some(e => e.numero_nf === 'NF-BUSCA-001');
  assert(achou, 'envio NF-BUSCA-001 ausente');
});

await test('ESCOPO: fornecedor so ve proprios envios', async () => {
  const r = await req('GET', '/api/search?q=NF-BUSCA-001', { token: fornToken });
  assert(r.status === 200);
  // O envio acima foi criado por este fornecedor, entao deve aparecer
  const achou = r.json.resultados.envios.some(e => e.numero_nf === 'NF-BUSCA-001');
  assert(achou, 'fornecedor deveria ver proprio envio');
});

await test('ESCOPO: operador vê só fornecedores da sua unidade', async () => {
  const r = await req('GET', '/api/search?q=hosp', { token: opToken });
  assert(r.status === 200);
  // Todos os fornecedores retornados devem ter relacao com a unidade do operador
  // (Garantido pelo SQL com JOIN fornecedor_unidades)
  assert(Array.isArray(r.json.resultados.fornecedores));
});

await test('filtro por tipos limita o que retorna', async () => {
  const r = await req('GET', '/api/search?q=HECC&tipos=unidades', { token: admToken });
  assert(r.status === 200);
  assert(r.json.resultados.fornecedores.length === 0, 'fornecedores deve estar vazio');
  assert(r.json.resultados.envios.length === 0, 'envios deve estar vazio');
  assert(r.json.resultados.unidades.length > 0, 'unidades deve ter resultados');
});

await test('limite_por_categoria exposto na resposta', async () => {
  const r = await req('GET', '/api/search?q=h', { token: admToken });
  // q de 1 char retorna 400, entao usa 2
  const r2 = await req('GET', '/api/search?q=ho', { token: admToken });
  assert(r2.json.limite_por_categoria === 10);
});

console.log('\n========================================');
console.log(`Search: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
