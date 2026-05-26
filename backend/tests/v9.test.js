// =====================================================================
// V9: Retificacao via portal + comentarios
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

console.log('\n[V9 · Setup]');
let tokenAdmin, tokenOp, tokenForn, tokenOpMrc;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenOp = await login('carlos.souza@fesfsus.ba.gov.br');
  tokenOpMrc = await login('beatriz.ramos@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

const unidades = (await req('GET', '/api/unidades')).json.unidades;
const heccId = unidades.find(u => u.sigla === 'HECC').id;
const modalidades = (await req('GET', '/api/modalidades')).json.modalidades;
const modMoeId = modalidades.find(m => m.codigo === 'indenizatorio_moe').id;

// ============================================
console.log('\n[V9 · Fluxo retificacao end-to-end]');

let envioId;
await test('fornecedor cria envio (v1)', async () => {
  const r = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modMoeId, competencia: '2026-12', valor_centavos: 100000, numero_nf: 'NF-V9-001', descricao: 'Original' }
  });
  assert(r.status === 201);
  envioId = r.json.envio.id;
});

await test('operador solicita retificacao', async () => {
  const r = await req('POST', `/api/envios/${envioId}/solicitar-retificacao`, {
    token: tokenOp, body: { motivo: 'Anexar comprovante INSS atualizado' }
  });
  assert(r.status === 200);
  assert(r.json.status === 'aguardando_ret');
});

await test('fornecedor recebe notificacao da retificacao', async () => {
  const r = await req('GET', '/api/notificacoes', { token: tokenForn });
  const visto = r.json.notificacoes.find(n => n.entidade_id === envioId && n.tipo === 'retificacao_solicitada');
  assert(visto, 'notificacao de retificacao nao encontrada');
});

await test('fornecedor envia nova versao via POST /versoes', async () => {
  const r = await req('POST', `/api/envios/${envioId}/versoes`, {
    token: tokenForn,
    body: {
      campos_revisados: ['valor', 'numero_nf'],
      observacao: 'Comprovante INSS anexado e valor corrigido para R$ 105.000,00',
      valor_centavos: 10500000, numero_nf: 'NF-V9-001-RET',
    }
  });
  assert(r.status === 201);
  assert(r.json.versao.numero === 2, `esperava v2, obteve v${r.json.versao.numero}`);
});

await test('apos nova versao status fica retificado', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: tokenOp });
  assert(r.json.envio.status === 'retificado');
  assert(r.json.versoes.length === 2);
});

await test('operador pode aprovar apos retificacao', async () => {
  const r = await req('POST', `/api/envios/${envioId}/aprovar`, { token: tokenOp, body: {} });
  assert(r.status === 200);
  assert(r.json.status === 'aprovado');
});

// ============================================
console.log('\n[V9 · Comentarios]');

let envioCom;
await test('cria envio para teste de comentarios', async () => {
  const r = await req('POST', '/api/envios/portal', {
    token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modMoeId, competencia: '2026-12', valor_centavos: 50000, numero_nf: 'NF-V9-COM-1' }
  });
  envioCom = r.json.envio.id;
});

await test('fornecedor adiciona comentario', async () => {
  const r = await req('POST', `/api/envios/${envioCom}/comentarios`, {
    token: tokenForn, body: { texto: 'Olá, gostaria de saber qual a previsão de análise.' }
  });
  assert(r.status === 201);
  assert(r.json.comentario.texto.includes('previsão'));
});

await test('operador da unidade ve o comentario', async () => {
  const r = await req('GET', `/api/envios/${envioCom}`, { token: tokenOp });
  assert(r.status === 200);
  assert(r.json.comentarios.length === 1);
  assert(r.json.comentarios[0].texto.includes('previsão'));
});

await test('operador responde com novo comentario', async () => {
  const r = await req('POST', `/api/envios/${envioCom}/comentarios`, {
    token: tokenOp, body: { texto: 'Em análise. Resposta esperada em 7 dias úteis.' }
  });
  assert(r.status === 201);
});

await test('thread de comentarios em ordem cronologica', async () => {
  const r = await req('GET', `/api/envios/${envioCom}`, { token: tokenForn });
  assert(r.json.comentarios.length === 2);
  const t1 = new Date(r.json.comentarios[0].criado_em);
  const t2 = new Date(r.json.comentarios[1].criado_em);
  assert(t1 <= t2, 'comentarios devem estar em ordem cronologica');
});

await test('comentario texto muito curto (1 char) rejeita 400', async () => {
  const r = await req('POST', `/api/envios/${envioCom}/comentarios`, {
    token: tokenForn, body: { texto: 'a' }
  });
  assert(r.status === 400);
});

await test('comentario sem auth retorna 401', async () => {
  const r = await req('POST', `/api/envios/${envioCom}/comentarios`, {
    body: { texto: 'hack tentativa' }
  });
  assert(r.status === 401);
});

await test('operador de OUTRA unidade NAO comenta em envio alheio', async () => {
  const r = await req('POST', `/api/envios/${envioCom}/comentarios`, {
    token: tokenOpMrc, body: { texto: 'comentario indevido' }
  });
  assert(r.status === 403);
});

await test('comentario do fornecedor notifica operadores', async () => {
  // Pega notificacao atual
  await req('POST', `/api/envios/${envioCom}/comentarios`, {
    token: tokenForn, body: { texto: 'Segue comentario teste notificacao operador' }
  });
  const r = await req('GET', '/api/notificacoes', { token: tokenOp });
  const visto = r.json.notificacoes.find(n => n.entidade_id === envioCom && n.mensagem.includes('comentário'));
  assert(visto, 'operador deveria ter recebido notificacao de comentario');
});

await test('comentario do operador notifica fornecedor', async () => {
  await req('POST', `/api/envios/${envioCom}/comentarios`, {
    token: tokenOp, body: { texto: 'comentario do operador teste notificacao' }
  });
  const r = await req('GET', '/api/notificacoes', { token: tokenForn });
  const visto = r.json.notificacoes.find(n => n.entidade_id === envioCom && n.mensagem.includes('comentário'));
  assert(visto, 'fornecedor deveria ter recebido notificacao de comentario');
});

console.log('\n========================================');
console.log(`V9: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
