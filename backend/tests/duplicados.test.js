// =====================================================================
// Deteccao de NF duplicada (fornecedor + NF + competencia)
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
  return { token: r.json.token, id: r.json.usuario.id, usuario: r.json.usuario };
}

console.log('\n[Detecção de NF duplicada]');

let admin, operador, fornecedor;
let heccId, modId, fornecedorId;
await test('logins + descobrir ids', async () => {
  admin = await login('maria.andrade@fesfsus.ba.gov.br');
  operador = await login('carlos.souza@fesfsus.ba.gov.br');
  fornecedor = await login('contato@empresahosp.com.br');
  fornecedorId = fornecedor.usuario.fornecedor_id;
  heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
});

// =================== CENARIO 1: Portal ===================
let envio1;
await test('portal: 1a submissao (NF DUP-1) com sucesso', async () => {
  const r = await req('POST', '/api/envios/portal', { token: fornecedor.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-07', valor_centavos: 100, numero_nf: 'DUP-1' } });
  assert(r.status === 201, `status ${r.status} ${r.text}`);
  envio1 = r.json.envio;
});

await test('portal: 2a submissao MESMA NF e competencia retorna 409', async () => {
  const r = await req('POST', '/api/envios/portal', { token: fornecedor.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-07', valor_centavos: 200, numero_nf: 'DUP-1' } });
  assert(r.status === 409, `esperava 409, veio ${r.status} ${r.text}`);
  assert(r.json.code === 'DUPLICATE_NF');
  assert(r.json.envio_existente.protocolo === envio1.protocolo);
});

await test('portal: MESMA NF mas competencia DIFERENTE passa (cada mes eh um envio)', async () => {
  const r = await req('POST', '/api/envios/portal', { token: fornecedor.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-08', valor_centavos: 200, numero_nf: 'DUP-1' } });
  assert(r.status === 201, `esperava 201, veio ${r.status} ${r.text}`);
});

await test('portal: NF DIFERENTE mesma competencia passa', async () => {
  const r = await req('POST', '/api/envios/portal', { token: fornecedor.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-07', valor_centavos: 200, numero_nf: 'DUP-2' } });
  assert(r.status === 201);
});

await test('portal: numero_nf ausente NUNCA bloqueia (nao tem como deduplicar)', async () => {
  const r1 = await req('POST', '/api/envios/portal', { token: fornecedor.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-07', valor_centavos: 200 } });
  const r2 = await req('POST', '/api/envios/portal', { token: fornecedor.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-07', valor_centavos: 300 } });
  assert(r1.status === 201 && r2.status === 201, `r1=${r1.status} r2=${r2.status}`);
});

// =================== Rejeitar permite ressubmeter ===================
await test('rejeitado libera para nova submissao da mesma NF', async () => {
  // Rejeita o envio1
  const rej = await req('POST', `/api/envios/${envio1.id}/rejeitar`, { token: operador.token, body: { motivo: 'erro de teste duplicado' } });
  assert(rej.status === 200, `rejeicao falhou: ${rej.text}`);
  // Agora tenta resubmeter mesma NF/competencia
  const r = await req('POST', '/api/envios/portal', { token: fornecedor.token,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-07', valor_centavos: 999, numero_nf: 'DUP-1' } });
  assert(r.status === 201, `esperava 201 apos rejeicao, veio ${r.status} ${r.text}`);
});

// =================== CENARIO 3: Manual ===================
await test('manual: bloqueia duplicado tambem', async () => {
  // Cria 1 envio manual com NF unica
  const r1 = await req('POST', '/api/envios/manual', { token: operador.token,
    body: { fornecedor_id: fornecedorId, unidade_id: heccId, modalidade_id: modId,
            competencia: '2026-09', valor_centavos: 500, numero_nf: 'MAN-DUP', motivo: 'lancamento de teste 1' } });
  assert(r1.status === 201, `1a manual falhou: ${r1.text}`);
  // 2a com mesma combinacao → 409
  const r2 = await req('POST', '/api/envios/manual', { token: operador.token,
    body: { fornecedor_id: fornecedorId, unidade_id: heccId, modalidade_id: modId,
            competencia: '2026-09', valor_centavos: 600, numero_nf: 'MAN-DUP', motivo: 'lancamento de teste 2' } });
  assert(r2.status === 409, `esperava 409, veio ${r2.status} ${r2.text}`);
  assert(r2.json.code === 'DUPLICATE_NF');
});

await test('manual: flag permitir_duplicado=true bypassa check', async () => {
  const r = await req('POST', '/api/envios/manual', { token: operador.token,
    body: { fornecedor_id: fornecedorId, unidade_id: heccId, modalidade_id: modId,
            competencia: '2026-09', valor_centavos: 700, numero_nf: 'MAN-DUP',
            motivo: 'justificativa para permitir', permitir_duplicado: true } });
  assert(r.status === 201, `esperava 201 com override, veio ${r.status} ${r.text}`);
});

// =================== Endpoint duplicados-recentes ===================
await test('GET /envios/duplicados-recentes lista grupos com > 1 envio', async () => {
  const r = await req('GET', '/api/envios/duplicados-recentes', { token: admin.token });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(Array.isArray(r.json.grupos));
  // Esperamos ao menos 1 grupo (MAN-DUP tem 2 envios em 2026-09 apos override)
  const manDup = r.json.grupos.find(g => g.numero_nf === 'MAN-DUP' && g.competencia === '2026-09');
  assert(manDup, `grupo MAN-DUP nao encontrado: ${JSON.stringify(r.json.grupos)}`);
  assert(manDup.qtd_envios >= 2);
  assert(Array.isArray(manDup.envios), `envios deveria ser array: ${JSON.stringify(manDup)}`);
  assert(manDup.envios.length === manDup.qtd_envios);
});

await test('duplicados-recentes: fornecedor 403', async () => {
  const r = await req('GET', '/api/envios/duplicados-recentes', { token: fornecedor.token });
  assert(r.status === 403, `veio ${r.status}`);
});

await test('duplicados-recentes: SEM auth 401', async () => {
  const r = await req('GET', '/api/envios/duplicados-recentes');
  assert(r.status === 401);
});

console.log('\n========================================');
console.log(`Duplicados: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
