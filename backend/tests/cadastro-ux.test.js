// =====================================================================
// V229 / F1.1 + F1.3: UX cadastro
// - nome_contato obrigatório
// - mensagem de CNPJ inválido detalhada
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body } = {}) {
  const headers = {};
  let bodyOut;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
// CNPJs com dígito verificador válido (gerados manualmente, sequência repetida rejeitada)
const CNPJS_VALIDOS = [
  '04252011000110', '60746948000112', '33000167000101',
  '02558157000162', '34028316000103',
];
let idx = 0;
function cnpjValido() { return CNPJS_VALIDOS[idx++ % CNPJS_VALIDOS.length]; }

console.log('\n[Cadastro UX — V229/F1.1+F1.3]');

// -------------------------------------------------------------------
// F1.3: nome_contato obrigatório
// -------------------------------------------------------------------
await test('F1.3: cadastro SEM nome_contato → 400 com msg clara', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', { body: {
    tipo: 'com_portal',
    razao_social: 'Teste Sem Contato',
    documento: cnpjValido(),
    email: `sem-contato-${Date.now()}@test.com`,
    unidades_siglas: ['HECC'],
    // sem nome_contato
  } });
  assert(r.status === 400, `status ${r.status}`);
  assert(/nome do contato|nome_contato|responsável/i.test(r.json.error),
    `mensagem deve mencionar nome do contato: ${r.json.error}`);
  assert(r.json.code === 'INVALID_NAME');
});

await test('F1.3: nome_contato muito curto (<3) → 400', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', { body: {
    tipo: 'com_portal',
    razao_social: 'Teste Curto',
    documento: cnpjValido(),
    email: `curto-${Date.now()}@test.com`,
    nome_contato: 'Jo',
    unidades_siglas: ['HECC'],
  } });
  assert(r.status === 400);
});

await test('F1.3: cadastro com nome_contato válido → 201 e nome_contato persiste', async () => {
  const cnpj = cnpjValido();
  const r = await req('POST', '/api/fornecedores/cadastrar', { body: {
    tipo: 'com_portal',
    razao_social: 'Teste Persiste Ltda',
    documento: cnpj,
    email: `persiste-${Date.now()}@test.com`,
    nome_contato: 'Maria Persiste Silva',
    unidades_siglas: ['HECC'],
  } });
  assert(r.status === 201, `status ${r.status} ${r.text}`);
  // Confirma persistência via admin/pendentes (admin vê os pendentes com nome_contato)
  const admLogin = await req('POST', '/api/auth/login', { body: { email: 'maria.andrade@fesfsus.ba.gov.br', senha: 'senha123' } });
  const tok = admLogin.json.token;
  const pend = await fetch(`${BASE}/api/fornecedores/pendentes`, { headers: { Authorization: `Bearer ${tok}` } });
  const list = (await pend.json()).pendentes || [];
  const meu = list.find(f => f.documento === cnpj);
  assert(meu, `fornecedor não está em pendentes (docs encontrados: ${list.map(f=>f.documento).join(',')})`);
  assert(meu.nome_contato === 'Maria Persiste Silva', `nome_contato não persistiu: ${meu.nome_contato}`);
});

// -------------------------------------------------------------------
// F1.1: mensagens de CNPJ/CPF inválido detalhadas
// -------------------------------------------------------------------
await test('F1.1: documento de 13 dígitos → msg menciona "11 ou 14"', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', { body: {
    tipo: 'com_portal',
    razao_social: 'Teste 13 dig',
    documento: '1234567890123', // 13 dígitos
    email: `inv-${Date.now()}@test.com`,
    nome_contato: 'Contato Teste',
    unidades_siglas: ['HECC'],
  } });
  assert(r.status === 400);
  assert(/11.*14|14.*11|13 dígito/i.test(r.json.error),
    `mensagem deveria mencionar contagem de dígitos: ${r.json.error}`);
});

await test('F1.1: CNPJ com sequência repetida → msg menciona "sequência repetida"', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', { body: {
    tipo: 'com_portal',
    razao_social: 'Teste seq',
    documento: '11111111111111',
    email: `seq-${Date.now()}@test.com`,
    nome_contato: 'Contato Seq',
    unidades_siglas: ['HECC'],
  } });
  assert(r.status === 400);
  assert(/sequência|seq|repetida/i.test(r.json.error), `msg: ${r.json.error}`);
});

await test('F1.1: CNPJ com dígito verificador errado → msg menciona "dígito verificador"', async () => {
  const r = await req('POST', '/api/fornecedores/cadastrar', { body: {
    tipo: 'com_portal',
    razao_social: 'Teste DV',
    documento: '12345678000199', // length 14 mas DV errado
    email: `dv-${Date.now()}@test.com`,
    nome_contato: 'Contato DV',
    unidades_siglas: ['HECC'],
  } });
  assert(r.status === 400);
  assert(/dígito verificador|verificador/i.test(r.json.error),
    `mensagem deveria mencionar dígito verificador: ${r.json.error}`);
});

await test('F1.1: validaDocumentoDetalhado helper diretamente', async () => {
  const { validaDocumentoDetalhado } = await import('../services/fornecedor-service.js');
  assert(validaDocumentoDetalhado('').valido === false);
  assert(validaDocumentoDetalhado('').erro.match(/obrigatorio/));
  assert(validaDocumentoDetalhado('123').valido === false);
  assert(/3 dígito/i.test(validaDocumentoDetalhado('123').erro));
  // CNPJ válido conhecido
  const ok = validaDocumentoDetalhado('04252011000110');
  assert(ok.valido === true && ok.tipo === 'CNPJ', `esperava válido CNPJ: ${JSON.stringify(ok)}`);
});

console.log('\n========================================');
console.log(`Cadastro-UX: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
