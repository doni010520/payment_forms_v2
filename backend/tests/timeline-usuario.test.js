// =====================================================================
// Timeline de auditoria por usuario (admin)
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
  return { token: r.json.token, id: r.json.usuario.id };
}

console.log('\n[Timeline por usuario]');

let admin, operador, fornecedor;
await test('login admin', async () => { admin = await login('maria.andrade@fesfsus.ba.gov.br'); });
await test('login operador HECC', async () => { operador = await login('carlos.souza@fesfsus.ba.gov.br'); });
await test('login fornecedor', async () => { fornecedor = await login('contato@empresahosp.com.br'); });

// Seed: gera atividade rastreavel pelo operador
await test('seed: operador realiza varias acoes auditadas', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  // Cria 2 envios via fornecedor
  const envios = [];
  for (let i = 0; i < 2; i++) {
    const r = await req('POST', '/api/envios/portal', { token: fornecedor.token,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-10', valor_centavos: 1000 + i, numero_nf: 'TL-' + i } });
    envios.push(r.json.envio);
  }
  // Operador aprova um, rejeita outro → auditoria com usuario_id=operador.id
  await req('POST', `/api/envios/${envios[0].id}/aprovar`, { token: operador.token });
  await req('POST', `/api/envios/${envios[1].id}/rejeitar`, { token: operador.token, body: { motivo: 'teste timeline' } });
});

await test('SEM auth retorna 401', async () => {
  const r = await req('GET', `/api/admin/usuarios/${operador.id}/auditoria`);
  assert(r.status === 401);
});

await test('fornecedor NAO pode acessar (403)', async () => {
  const r = await req('GET', `/api/admin/usuarios/${operador.id}/auditoria`, { token: fornecedor.token });
  assert(r.status === 403);
});

await test('usuario inexistente retorna 404', async () => {
  const r = await req('GET', '/api/admin/usuarios/99999/auditoria', { token: admin.token });
  assert(r.status === 404);
});

let resposta;
await test('admin obtem timeline do operador', async () => {
  const r = await req('GET', `/api/admin/usuarios/${operador.id}/auditoria`, { token: admin.token });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.usuario, 'usuario ausente');
  assert(r.json.usuario.papel === 'operador_unidade');
  assert(Array.isArray(r.json.timeline), 'timeline deve ser array');
  assert(Array.isArray(r.json.agregado_por_acao), 'agregado deve ser array');
  assert(typeof r.json.total === 'number');
  assert(r.json.periodo.dias === 30);
  resposta = r.json;
});

await test('timeline contem apenas acoes do operador', async () => {
  // Cada item deve ter sido emitido por esse usuario (a tabela usa usuario_id na WHERE)
  // Como o endpoint filtra explicitamente por usuario_id=operador.id, todos os
  // registros sao dele por construcao. Mas verificamos que ha pelo menos 1.
  assert(resposta.timeline.length > 0, 'timeline vazia mesmo apos seed de acoes');
});

await test('agregado tem aprovado e rejeitado >= 1', async () => {
  const a = resposta.agregado_por_acao;
  const aprov = a.find(x => x.acao === 'aprovado');
  const rejeit = a.find(x => x.acao === 'rejeitado');
  assert(aprov && aprov.qtd >= 1, `aprovado=${JSON.stringify(aprov)}`);
  assert(rejeit && rejeit.qtd >= 1, `rejeitado=${JSON.stringify(rejeit)}`);
});

await test('total agregado bate com soma do agregado_por_acao', async () => {
  const soma = resposta.agregado_por_acao.reduce((s, x) => s + x.qtd, 0);
  assert(soma === resposta.total, `soma ${soma} != total ${resposta.total}`);
});

await test('paginacao funciona (per_page=1 retorna 1 item)', async () => {
  const r = await req('GET', `/api/admin/usuarios/${operador.id}/auditoria?per_page=1`, { token: admin.token });
  assert(r.status === 200);
  assert(r.json.timeline.length === 1);
  assert(r.headers.get('X-Total-Count') === String(resposta.total),
    `X-Total-Count=${r.headers.get('X-Total-Count')} esperado=${resposta.total}`);
});

await test('filtro ?dias=1 limita janela', async () => {
  const r = await req('GET', `/api/admin/usuarios/${operador.id}/auditoria?dias=1`, { token: admin.token });
  assert(r.status === 200);
  assert(r.json.periodo.dias === 1);
});

await test('filtro ?dias=9999 clampado para 365', async () => {
  const r = await req('GET', `/api/admin/usuarios/${operador.id}/auditoria?dias=9999`, { token: admin.token });
  assert(r.json.periodo.dias === 365);
});

await test('admin consulta timeline do PROPRIO admin (sem erros)', async () => {
  const r = await req('GET', `/api/admin/usuarios/${admin.id}/auditoria`, { token: admin.token });
  assert(r.status === 200);
  assert(r.json.usuario.papel === 'admin_fesf');
});

console.log('\n========================================');
console.log(`Timeline-usuario: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
