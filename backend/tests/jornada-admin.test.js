// =====================================================================
// V223 / Fase 3D — jornada admin FESF Sede
// Valida quick wins A1 (helper de senha temporária) + A5 (engajamento via UI).
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
  return r.json && r.json.token;
}

console.log('\n[Jornada admin FESF (V223)]');

let admTok, opTok;
await test('logins admin + operador', async () => {
  admTok = await login('maria.andrade@fesfsus.ba.gov.br');
  opTok  = await login('carlos.souza@fesfsus.ba.gov.br');
  assert(admTok, 'admin login falhou');
  assert(opTok, 'operador login falhou');
});

// -------------------------------------------------------------------
// A1: helper /app/senha-temp-modal.js servido + injetado nas telas certas
// -------------------------------------------------------------------
await test('A1: /app/senha-temp-modal.js é servido pelo backend', async () => {
  const r = await fetch(`${BASE}/app/senha-temp-modal.js`);
  assert(r.status === 200, `status ${r.status}`);
  const body = await r.text();
  assert(/mostrarSenhaTemp/.test(body), 'helper sem mostrarSenhaTemp');
  assert(/Copiar|copia/i.test(body), 'helper sem ação de copiar');
  assert(/canal seguro/i.test(body), 'helper sem aviso de canal seguro');
});

await test('A1: admin.html injeta senha-temp-modal e usa mostrarSenhaTemp', async () => {
  const html = await (await fetch(`${BASE}/app/admin.html`)).text();
  // V298: regex tolera cache-buster ?v=... injetado em runtime
  assert(/src="\/app\/senha-temp-modal\.js(\?v=[^"]+)?"/.test(html), 'admin.html sem script tag do helper');
  assert(/mostrarSenhaTemp\(/.test(html), 'admin.html não chama mostrarSenhaTemp');
  assert(!/alert\(['"`]Fornecedor aprovado/i.test(html), 'admin.html ainda usa alert nativo p/ senha');
});

await test('A1: admin-usuarios.html injeta helper e usa em criar + resetar', async () => {
  const html = await (await fetch(`${BASE}/app/admin-usuarios.html`)).text();
  // V298: regex tolera cache-buster ?v=... injetado em runtime
  assert(/src="\/app\/senha-temp-modal\.js(\?v=[^"]+)?"/.test(html), 'admin-usuarios.html sem script tag do helper');
  const ocorrencias = (html.match(/mostrarSenhaTemp\(/g) || []).length;
  assert(ocorrencias >= 2, `esperava 2+ usos (criar + reset), achei ${ocorrencias}`);
});

// -------------------------------------------------------------------
// A5: UI de engajamento (admin-fornecedor.html) + endpoint funcional
// -------------------------------------------------------------------
await test('A5: admin-fornecedor.html expõe 3 botões de engajamento', async () => {
  const html = await (await fetch(`${BASE}/app/admin-fornecedor.html`)).text();
  assert(/marcarInadimplente\(/.test(html), 'falta botão marcar inadimplente');
  assert(/reverterEngajamento\(/.test(html), 'falta botão reverter engajamento');
  assert(/marcarInativo\(/.test(html), 'falta botão marcar inativo');
  assert(/engBadge/.test(html), 'badge de engajamento não está sendo construído');
  assert(/atualizarEngajamentoFornecedor/.test(html), 'não chama api.atualizarEngajamentoFornecedor');
});

// Pool de CNPJs válidos (digito verificador correto) — alternam entre runs
const CNPJS_VALIDOS = [
  '19131243000197', '11444777000161', '04252011000110',
  '60746948000112', '07526557000100', '33000167000101',
];
let fornAprId = null;
await test('A5: admin aprova fornecedor pendente → recebe senha_temporaria', async () => {
  // Tenta varios CNPJs até achar um que ainda não foi cadastrado
  const ts = Date.now();
  let cadOk = null;
  for (const cnpj of CNPJS_VALIDOS) {
    const cad = await req('POST', '/api/fornecedores/cadastrar', { body: {
      tipo: 'com_portal',
      razao_social: 'A5 Teste Ltda ' + ts,
      documento: cnpj,
      email: `a5-${ts}-${cnpj.substring(0,4)}@teste.com`,
      telefone: '71999990000',
      nome_contato: 'Contato A5',
      unidades_siglas: ['HECC'],
    } });
    if (cad.status === 201) { cadOk = cad; break; }
    if (cad.status !== 409) throw new Error(`cadastro status ${cad.status} ${cad.text}`);
  }
  if (cadOk) {
    fornAprId = cadOk.json.id;
    // Aprova como admin
    const ap = await req('POST', `/api/fornecedores/${fornAprId}/aprovar`, { token: admTok });
    assert(ap.status === 200 || ap.status === 201, `aprovar status ${ap.status} ${ap.text}`);
    assert(ap.json.senha_temporaria, 'aprovar não devolveu senha_temporaria');
    assert(ap.json.senha_temporaria.length >= 8, 'senha_temporaria muito curta');
  } else {
    // Todos os CNPJs já existem — usa um existente ativo só para os testes de engajamento
    const list = (await req('GET', '/api/fornecedores', { token: admTok })).json.fornecedores || [];
    const ativo = list.find(f => f.ativo);
    assert(ativo, 'sem fornecedor ativo para fallback');
    fornAprId = ativo.id;
    console.log('    [skip-approval: usando fornecedor existente id=' + fornAprId + ']');
  }
});

await test('A5: marcar inadimplente sem motivo → 400', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornAprId}/engajamento`,
    { token: admTok, body: { status: 'inadimplente' } });
  assert(r.status === 400, `esperava 400, veio ${r.status} ${r.text}`);
});

await test('A5: marcar inadimplente com motivo válido → 200 + auditoria', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornAprId}/engajamento`,
    { token: admTok, body: { status: 'inadimplente', motivo: 'fornecedor parou de enviar há 60d' } });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.status_engajamento === 'inadimplente');
  // Confirma persistido (endpoint admin detalhe)
  const det = await req('GET', `/api/fornecedores/${fornAprId}/detalhe`, { token: admTok });
  assert(det.status === 200, `detalhe status ${det.status} ${det.text}`);
  const f = det.json.fornecedor || det.json;
  assert(f.status_engajamento === 'inadimplente', `status não persistiu: ${f.status_engajamento}`);
  assert(/parou de enviar/.test(f.motivo_engajamento || ''), `motivo não persistiu: ${f.motivo_engajamento}`);
});

await test('A5: reverter para ativo → status volta para ativo', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornAprId}/engajamento`,
    { token: admTok, body: { status: 'ativo' } });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.status_engajamento === 'ativo');
});

await test('A5: marcar inativo (encerramento de contrato)', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornAprId}/engajamento`,
    { token: admTok, body: { status: 'inativo', motivo: 'contrato encerrado em 2026-05' } });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(r.json.status_engajamento === 'inativo');
});

await test('A5: status inválido → 400', async () => {
  const r = await req('PATCH', `/api/fornecedores/${fornAprId}/engajamento`,
    { token: admTok, body: { status: 'desligado', motivo: 'qualquer' } });
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
});

await test('A5: operador comum também pode atualizar engajamento', async () => {
  // É operador, deve poder marcar inadimplente conforme requireRole('operador_unidade','admin_fesf')
  const r = await req('PATCH', `/api/fornecedores/${fornAprId}/engajamento`,
    { token: opTok, body: { status: 'ativo' } });
  assert(r.status === 200, `status ${r.status} ${r.text}`);
});

console.log('\n========================================');
console.log(`Jornada-admin: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
