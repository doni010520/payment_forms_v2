// =====================================================================
// V231 / O2 — anotações visíveis entre operadores da mesma unidade
//
// Cobre:
//   - Anotação criada por operador A é visível para operador B (mesma unidade)
//   - Quando B edita, criado_por permanece A, operador (último editor) = B
//   - Flag editada_por_outro fica true após troca de mão
//   - atualizado_em avança no UPDATE
//   - Mesmo padrão para anotações de documento
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
async function login(email, senha = 'senha123') {
  const r = await req('POST', '/api/auth/login', { body: { email, senha } });
  return r.json && r.json.token;
}

console.log('\n[Anotações colaborativas — V231/O2]');

let opATok, opBTok, admTok, fornTok, envId, docId;

await test('setup: dois operadores HECC + admin + fornecedor + envio com doc', async () => {
  admTok = await login('maria.andrade@fesfsus.ba.gov.br');
  opATok = await login('carlos.souza@fesfsus.ba.gov.br'); // HECC
  fornTok = await login('contato@empresahosp.com.br');
  assert(admTok && opATok && fornTok);
  // Cria SEGUNDO operador HECC (precisa ser admin)
  const opBEmail = `op-b-hecc-${Date.now()}@fesf.test`;
  const cr = await req('POST', '/api/usuarios', { token: admTok, body: {
    papel: 'operador_unidade', nome: 'Operador B HECC', email: opBEmail, unidade_id: 1,
    // V229 nome_contato não se aplica a usuários — só fornecedores
  } });
  assert(cr.status === 201, `criar op B: ${cr.text}`);
  const senhaTemp = cr.json.senha_temporaria;
  // Op B precisa trocar senha antes de operar (V226/F1.4)
  const loginB = await req('POST', '/api/auth/login', { body: { email: opBEmail, senha: senhaTemp } });
  assert(loginB.status === 200);
  const tokenTemp = loginB.json.token;
  const trocar = await req('POST', '/api/me/senha', { token: tokenTemp, body: {
    senha_atual: senhaTemp, nova_senha: 'NovaSenhaOpB2026!',
  } });
  assert(trocar.status === 200);
  opBTok = trocar.json.novo_token;
  assert(opBTok, 'sem token após troca de senha');

  // Cria envio + upload doc
  const env = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-05',
    valor_centavos: 99000, numero_nf: 'O2-' + Date.now(),
  } });
  assert(env.status === 201);
  envId = env.json.envio.id;
  const fd = new FormData();
  fd.append('arquivo', new Blob(['anotacao test'], { type: 'text/plain' }), 'nf-anotacao.pdf');
  fd.append('campo', 'q5_nf');
  const up = await fetch(`${BASE}/api/envios/${envId}/documentos`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + fornTok }, body: fd
  });
  assert(up.status === 201);
  docId = (await up.json()).documento.id;
});

// -------------------------------------------------------------------
// 1. Operador A anota campo, B vê
// -------------------------------------------------------------------
await test('Op A anota campo q5_nf → Op B vê na leitura', async () => {
  const r1 = await req('POST', `/api/envios/${envId}/anotacoes`, { token: opATok, body: {
    campo: 'q5_nf', status: 'duvida', observacao: 'verificar carimbo da NF',
  } });
  assert(r1.status === 201, `status ${r1.status} ${r1.text}`);

  const r2 = await req('GET', `/api/envios/${envId}`, { token: opBTok });
  assert(r2.status === 200);
  const an = r2.json.anotacoes.find(a => a.campo === 'q5_nf');
  assert(an, 'Op B não enxerga anotação');
  assert(an.status === 'duvida');
  assert(an.operador_nome === 'Carlos Souza (HECC)', `operador errado: ${an.operador_nome}`);
  assert(an.criado_por_nome === 'Carlos Souza (HECC)', `criado_por errado: ${an.criado_por_nome}`);
  assert(an.editada_por_outro === false, 'editada_por_outro deveria ser false');
});

// -------------------------------------------------------------------
// 2. Op B edita a anotação → criado_por preserva A, operador vira B
// -------------------------------------------------------------------
await test('Op B edita → criado_por permanece A, operador vira B', async () => {
  // Espera 1s para garantir atualizado_em maior que criado_em
  await new Promise(res => setTimeout(res, 1100));
  const r1 = await req('POST', `/api/envios/${envId}/anotacoes`, { token: opBTok, body: {
    campo: 'q5_nf', status: 'verificado', observacao: 'conferi carimbo, OK',
  } });
  assert(r1.status === 201);

  const r2 = await req('GET', `/api/envios/${envId}`, { token: opATok });
  const an = r2.json.anotacoes.find(a => a.campo === 'q5_nf');
  assert(an.status === 'verificado');
  assert(an.operador_nome === 'Operador B HECC', `op atual: ${an.operador_nome}`);
  assert(an.criado_por_nome === 'Carlos Souza (HECC)', `criado_por: ${an.criado_por_nome}`);
  assert(an.editada_por_outro === true, 'editada_por_outro deveria ser true');
  // atualizado_em deve ser > criado_em
  assert(new Date(an.atualizado_em) > new Date(an.criado_em), 'atualizado_em não avançou');
});

// -------------------------------------------------------------------
// 3. Operador de OUTRA unidade não vê (segurança)
// -------------------------------------------------------------------
await test('Operador de outra unidade NÃO vê anotações (403 no envio)', async () => {
  const opMrc = await login('beatriz.ramos@fesfsus.ba.gov.br'); // MRC
  if (!opMrc) { console.log('    [skip: sem op MRC]'); return; }
  const r = await req('GET', `/api/envios/${envId}`, { token: opMrc });
  assert(r.status === 403, `esperava 403, veio ${r.status}`);
});

// -------------------------------------------------------------------
// 4. Anotações de documento têm mesmo padrão de visibilidade
// -------------------------------------------------------------------
await test('Op A anota documento → Op B vê', async () => {
  const r1 = await req('POST', `/api/envios/${envId}/documentos/${docId}/anotacao`, {
    token: opATok, body: { status: 'problema', observacao: 'ilegível' }
  });
  assert(r1.status === 201, r1.text);
  const r2 = await req('GET', `/api/envios/${envId}`, { token: opBTok });
  const ad = r2.json.anotacoes_documento.find(x => x.documento_id === docId);
  assert(ad, 'Op B não vê anotação de doc');
  assert(ad.criado_por_nome === 'Carlos Souza (HECC)');
  assert(ad.operador_nome === 'Carlos Souza (HECC)');
});

await test('Op B atualiza anotação de doc → editada_por_outro=true', async () => {
  await new Promise(res => setTimeout(res, 1100));
  const r1 = await req('POST', `/api/envios/${envId}/documentos/${docId}/anotacao`, {
    token: opBTok, body: { status: 'verificado', observacao: 'agora legível' }
  });
  assert(r1.status === 201);
  const r2 = await req('GET', `/api/envios/${envId}`, { token: opATok });
  const ad = r2.json.anotacoes_documento.find(x => x.documento_id === docId);
  assert(ad.editada_por_outro === true);
  assert(ad.criado_por_nome === 'Carlos Souza (HECC)');
  assert(ad.operador_nome === 'Operador B HECC');
});

// -------------------------------------------------------------------
// 5. Fornecedor não vê anotações (privacidade da análise)
// -------------------------------------------------------------------
await test('Fornecedor dono do envio NÃO recebe anotações', async () => {
  const r = await req('GET', `/api/envios/${envId}`, { token: fornTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.anotacoes) && r.json.anotacoes.length === 0,
    'fornecedor recebeu anotações (devia ser []): ' + JSON.stringify(r.json.anotacoes));
  assert(r.json.anotacoes_documento.length === 0,
    'fornecedor recebeu anotações de doc (devia ser [])');
});

console.log('\n========================================');
console.log(`Anotações colaborativas: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
