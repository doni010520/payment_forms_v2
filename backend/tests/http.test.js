// =====================================================================
// Testes HTTP ponta-a-ponta contra o servidor real
// Pressupoe que o servidor esta rodando em http://localhost:3000
// =====================================================================

const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;

async function test(nome, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nome}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${nome}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert falhou');
}

async function req(method, path, { body, token } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, {
    method, headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

console.log('\n[HTTP · Health]');
await test('GET /api/health responde 200', async () => {
  const r = await req('GET', '/api/health');
  assert(r.status === 200);
  assert(r.json.ok === true);
});

console.log('\n[HTTP · Listas publicas]');
await test('GET /api/unidades lista as 8 unidades', async () => {
  const r = await req('GET', '/api/unidades');
  assert(r.status === 200);
  assert(Array.isArray(r.json.unidades));
  assert(r.json.unidades.length === 8, `esperado 8, obtido ${r.json.unidades.length}`);
});

await test('GET /api/modalidades lista 6 modalidades', async () => {
  const r = await req('GET', '/api/modalidades');
  assert(r.status === 200);
  assert(r.json.modalidades.length === 6);
});

console.log('\n[HTTP · Auth]');
let tokenForn, tokenOp, tokenAdmin;

await test('POST /api/auth/login (fornecedor) retorna token', async () => {
  const r = await req('POST', '/api/auth/login', {
    body: { email: 'contato@empresahosp.com.br', senha: 'senha123' }
  });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.json.token);
  tokenForn = r.json.token;
});

await test('POST /api/auth/login (operador HECC)', async () => {
  const r = await req('POST', '/api/auth/login', {
    body: { email: 'carlos.souza@fesfsus.ba.gov.br', senha: 'senha123' }
  });
  assert(r.status === 200, `status=${r.status}`);
  tokenOp = r.json.token;
});

await test('POST /api/auth/login (admin FESF)', async () => {
  const r = await req('POST', '/api/auth/login', {
    body: { email: 'maria.andrade@fesfsus.ba.gov.br', senha: 'senha123' }
  });
  assert(r.status === 200);
  tokenAdmin = r.json.token;
});

await test('login com senha errada retorna 401', async () => {
  const r = await req('POST', '/api/auth/login', {
    body: { email: 'contato@empresahosp.com.br', senha: 'errada' }
  });
  assert(r.status === 401);
});

console.log('\n[HTTP · Envios via Portal (cenario 1)]');
await test('POST /api/envios/portal cria envio (fornecedor logado)', async () => {
  // primeiro descobre unidade que o fornecedor atende
  const unidades = (await req('GET', '/api/unidades')).json.unidades;
  const heccId = unidades.find(u => u.sigla === 'HECC').id;
  const modalidades = (await req('GET', '/api/modalidades')).json.modalidades;
  const modMoeId = modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: {
      unidade_id: heccId, modalidade_id: modMoeId, competencia: '2026-09',
      valor_centavos: 5000000, numero_nf: 'NF-HTTP-001', descricao: 'Teste HTTP'
    }
  });
  assert(r.status === 201, `status ${r.status} body=${JSON.stringify(r.json)}`);
  assert(r.json.envio.origem === 'portal');
  assert(r.json.envio.protocolo);
});

await test('POST /api/envios/portal sem token retorna 401', async () => {
  const r = await req('POST', '/api/envios/portal', {
    body: { unidade_id: 1, modalidade_id: 1, competencia: '2026-09' }
  });
  assert(r.status === 401);
});

console.log('\n[HTTP · Envios via Link Publico (cenario 2)]');
let token2 = null;
await test('POST /api/links cria link publico (operador)', async () => {
  const unidades = (await req('GET', '/api/unidades')).json.unidades;
  const heccId = unidades.find(u => u.sigla === 'HECC').id;
  const modalidades = (await req('GET', '/api/modalidades')).json.modalidades;
  const modInsumosId = modalidades.find(m => m.codigo === 'pagamento_insumos').id;
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenOp })).json.fornecedores;
  const fornInsumosJose = fornecs.find(f => f.documento === '88111222000150');
  const r = await req('POST', '/api/links', {
    token: tokenOp,
    body: {
      fornecedor_id: fornInsumosJose.id,
      unidade_id: heccId,
      modalidade_id: modInsumosId,
      email_destinatario: 'teste@http.com',
    }
  });
  assert(r.status === 201, `status=${r.status} body=${JSON.stringify(r.json)}`);
  assert(r.json.link.token);
  token2 = r.json.link.token;
});

await test('GET /api/links/:token retorna contexto sem auth', async () => {
  const r = await req('GET', `/api/links/${token2}`);
  assert(r.status === 200);
  assert(r.json.valido === true);
  assert(r.json.unidade_sigla === 'HECC');
});

await test('POST /api/envios/publico/:token submete sem login', async () => {
  const r = await req('POST', `/api/envios/publico/${token2}`, {
    body: {
      competencia: '2026-09',
      valor_centavos: 1200000,
      numero_nf: 'NF-PUB-001',
      descricao: 'Submissao publica HTTP',
      submetente_nome: 'Maria Submetente',
      submetente_documento: '88111222000150',
    }
  });
  assert(r.status === 201, `status=${r.status} body=${JSON.stringify(r.json)}`);
  assert(r.json.envio.origem === 'link_publico');
});

await test('token publico reutilizado rejeita 400', async () => {
  const r = await req('POST', `/api/envios/publico/${token2}`, {
    body: { competencia: '2026-10' }
  });
  assert(r.status === 400);
  assert(r.json.code === 'ALREADY_USED');
});

console.log('\n[HTTP · Lancamento Manual (cenario 3)]');
await test('POST /api/envios/manual cria envio (operador)', async () => {
  const unidades = (await req('GET', '/api/unidades')).json.unidades;
  const heccId = unidades.find(u => u.sigla === 'HECC').id;
  const modalidades = (await req('GET', '/api/modalidades')).json.modalidades;
  const modServId = modalidades.find(m => m.codigo === 'pagamento_servico').id;
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenOp })).json.fornecedores;
  const fornMaria = fornecs.find(f => f.documento === '12345678900');
  const r = await req('POST', '/api/envios/manual', {
    token: tokenOp,
    body: {
      fornecedor_id: fornMaria.id,
      unidade_id: heccId,
      modalidade_id: modServId,
      competencia: '2026-09',
      valor_centavos: 350000,
      descricao: 'Lancamento manual HTTP',
      motivo: 'Fornecedor PF sem e-mail; contato verbal',
    }
  });
  assert(r.status === 201, `status=${r.status} body=${JSON.stringify(r.json)}`);
  assert(r.json.envio.origem === 'manual');
  assert(r.json.envio.motivo_manual);
});

await test('lancamento manual sem motivo retorna 400', async () => {
  const r = await req('POST', '/api/envios/manual', {
    token: tokenOp,
    body: { fornecedor_id: 1, unidade_id: 1, modalidade_id: 1, competencia: '2026-09' }
  });
  assert(r.status === 400);
});

console.log('\n[HTTP · Listagens]');
await test('GET /api/envios (operador) retorna so envios da unidade', async () => {
  const r = await req('GET', '/api/envios', { token: tokenOp });
  assert(r.status === 200);
  assert(Array.isArray(r.json.envios));
  assert(r.json.envios.length > 0);
});

await test('GET /api/envios?origem=manual filtra corretamente', async () => {
  const r = await req('GET', '/api/envios?origem=manual', { token: tokenOp });
  assert(r.status === 200);
  for (const e of r.json.envios) assert(e.origem === 'manual', `envio ${e.id} tem origem=${e.origem}`);
});

await test('GET /api/envios/resumo/origem retorna agregacao', async () => {
  const r = await req('GET', '/api/envios/resumo/origem', { token: tokenAdmin });
  assert(r.status === 200);
  assert(Array.isArray(r.json.por_origem));
});

console.log('\n[HTTP · Expectativas]');
let expId = null;
await test('POST /api/expectativas (operador) cria expectativa', async () => {
  const unidades = (await req('GET', '/api/unidades')).json.unidades;
  const heccId = unidades.find(u => u.sigla === 'HECC').id;
  const modalidades = (await req('GET', '/api/modalidades')).json.modalidades;
  const modMoeId = modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const fornecs = (await req('GET', '/api/fornecedores', { token: tokenOp })).json.fornecedores;
  const r = await req('POST', '/api/expectativas', {
    token: tokenOp,
    body: {
      fornecedor_id: fornecs[0].id,
      unidade_id: heccId,
      modalidade_id: modMoeId,
      competencia: '2026-10',
      prazo: '2026-10-25',
      origem_prevista: 'portal',
    }
  });
  assert(r.status === 201, `status=${r.status} body=${JSON.stringify(r.json)}`);
  expId = r.json.expectativa.id;
});

await test('POST /api/expectativas/:id/lembrete envia lembrete', async () => {
  const r = await req('POST', `/api/expectativas/${expId}/lembrete`, {
    token: tokenOp,
    body: { canal: 'email' }
  });
  assert(r.status === 200);
  assert(r.json.numero === 1);
});

await test('GET /api/expectativas (operador) lista', async () => {
  const r = await req('GET', '/api/expectativas', { token: tokenOp });
  assert(r.status === 200);
  assert(r.json.expectativas.length > 0);
});

console.log('\n========================================');
console.log(`HTTP: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
