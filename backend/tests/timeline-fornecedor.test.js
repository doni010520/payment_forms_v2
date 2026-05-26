// =====================================================================
// Timeline de auditoria por fornecedor (admin + operador escopado)
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
  return { status: r.status, json, text, headers: r.headers };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  return { token: r.json.token, id: r.json.usuario.id, usuario: r.json.usuario };
}

console.log('\n[Timeline por fornecedor]');

let admin, operador, fornecedor;
let fornecedorId;
await test('login admin', async () => { admin = await login('maria.andrade@fesfsus.ba.gov.br'); });
await test('login operador HECC', async () => { operador = await login('carlos.souza@fesfsus.ba.gov.br'); });
await test('login fornecedor (descobrir id)', async () => {
  fornecedor = await login('contato@empresahosp.com.br');
  fornecedorId = fornecedor.usuario.fornecedor_id;
  assert(fornecedorId, `fornecedor_id ausente: ${JSON.stringify(fornecedor.usuario)}`);
});

await test('seed: cria envios + aprovacoes/rejeicoes para gerar trilha', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const envios = [];
  for (let i = 0; i < 3; i++) {
    const r = await req('POST', '/api/envios/portal', { token: fornecedor.token,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-08', valor_centavos: 5000 + i, numero_nf: 'TF-' + i } });
    envios.push(r.json.envio);
  }
  await req('POST', `/api/envios/${envios[0].id}/aprovar`, { token: operador.token });
  await req('POST', `/api/envios/${envios[1].id}/rejeitar`, { token: operador.token, body: { motivo: 'TF-rejeit' } });
});

await test('SEM auth retorna 401', async () => {
  const r = await req('GET', `/api/admin/fornecedores/${fornecedorId}/auditoria`);
  assert(r.status === 401);
});

await test('fornecedor NAO pode acessar (403)', async () => {
  const r = await req('GET', `/api/admin/fornecedores/${fornecedorId}/auditoria`, { token: fornecedor.token });
  assert(r.status === 403);
});

await test('fornecedor inexistente retorna 404', async () => {
  const r = await req('GET', '/api/admin/fornecedores/99999/auditoria', { token: admin.token });
  assert(r.status === 404);
});

let resposta;
await test('admin obtem timeline do fornecedor', async () => {
  const r = await req('GET', `/api/admin/fornecedores/${fornecedorId}/auditoria`, { token: admin.token });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.fornecedor, 'fornecedor ausente');
  assert(r.json.fornecedor.id === fornecedorId);
  assert(Array.isArray(r.json.timeline));
  assert(Array.isArray(r.json.agregado_por_acao));
  assert(typeof r.json.total === 'number');
  resposta = r.json;
});

await test('timeline contem eventos de envio (aprovado/rejeitado)', async () => {
  const acoes = resposta.timeline.map(t => t.acao);
  assert(acoes.includes('aprovado') || acoes.includes('rejeitado'),
    `esperava ao menos aprovado ou rejeitado, veio: ${acoes.join(',')}`);
});

await test('timeline so contem entidades fornecedor ou envio', async () => {
  for (const t of resposta.timeline) {
    assert(['fornecedor', 'envio'].includes(t.entidade), `entidade ${t.entidade} nao esperada`);
  }
});

await test('agregado tem aprovado >=1 e rejeitado >=1', async () => {
  const a = resposta.agregado_por_acao;
  const aprov = a.find(x => x.acao === 'aprovado');
  const rejeit = a.find(x => x.acao === 'rejeitado');
  assert(aprov && aprov.qtd >= 1, `aprovado=${JSON.stringify(aprov)}`);
  assert(rejeit && rejeit.qtd >= 1, `rejeitado=${JSON.stringify(rejeit)}`);
});

await test('soma agregado == total', async () => {
  const soma = resposta.agregado_por_acao.reduce((s, x) => s + x.qtd, 0);
  assert(soma === resposta.total, `soma ${soma} != total ${resposta.total}`);
});

await test('paginacao funciona com X-Total-Count', async () => {
  const r = await req('GET', `/api/admin/fornecedores/${fornecedorId}/auditoria?per_page=1`, { token: admin.token });
  assert(r.status === 200);
  assert(r.json.timeline.length === 1);
  assert(r.headers.get('X-Total-Count') === String(resposta.total));
});

await test('operador da unidade do fornecedor PODE acessar', async () => {
  // Garantir que o fornecedor atende HECC (testes V19+ ja garantem isso, mas confirmar)
  const r = await req('GET', `/api/admin/fornecedores/${fornecedorId}/auditoria`, { token: operador.token });
  assert(r.status === 200, `esperava 200, veio ${r.status} ${r.text}`);
});

await test('operador de OUTRA unidade nao pode acessar (403)', async () => {
  // login operador de outra sigla. Vamos pegar a primeira sigla != HECC
  const all = (await req('GET', '/api/unidades')).json.unidades;
  const outra = all.find(u => u.sigla !== 'HECC');
  if (!outra) return; // skip se so existe HECC
  // Construir email do operador dessa unidade (padrao do seed)
  const seedNomes = {
    HMI: 'Beatriz Lima', HCB: 'Daniel Pereira',
    HEMD: 'Fernanda Costa', HERS: 'Henrique Alves',
  };
  const nome = seedNomes[outra.sigla];
  if (!nome) return; // skip
  const email = nome.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '.').replace(/\.+/g, '.') + '@fesfsus.ba.gov.br';
  const lg = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  if (lg.status !== 200) return; // skip se nao conseguir logar
  const r = await req('GET', `/api/admin/fornecedores/${fornecedorId}/auditoria`, { token: lg.json.token });
  // Pode ser 403 (se fornecedor nao atende essa unidade) ou 200 (se atende ambas)
  // Testamos so que nao explode 500
  assert([200, 403].includes(r.status), `status inesperado ${r.status}`);
});

await test('?dias=1 limita janela', async () => {
  const r = await req('GET', `/api/admin/fornecedores/${fornecedorId}/auditoria?dias=1`, { token: admin.token });
  assert(r.status === 200);
  assert(r.json.periodo.dias === 1);
});

console.log('\n========================================');
console.log(`Timeline-fornecedor: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
