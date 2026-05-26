// =====================================================================
// Paginacao padronizada: ?page=&per_page= + headers X-Total-*
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
  return r.json.token;
}

console.log('\n[Paginacao]');

let admToken, fornToken;
await test('login admin', async () => { admToken = await login('maria.andrade@fesfsus.ba.gov.br'); });
await test('login fornecedor', async () => { fornToken = await login('contato@empresahosp.com.br'); });

// Gera algumas notificacoes para o fornecedor (atravez de uma acao que cria notif)
// Mais facil: usar a tabela direto via API — vamos disparar varias acoes que geram notif
await test('seed: criar varias notificacoes via acoes (envio + comentario)', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  // Cria varios envios → cada um pode gerar notificacao
  for (let i = 0; i < 5; i++) {
    await req('POST', '/api/envios/portal', { token: fornToken,
      body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100 + i, numero_nf: 'PG-' + i } });
  }
});

await test('GET /notificacoes default per_page=50, retorna headers X-Total-*', async () => {
  const r = await req('GET', '/api/notificacoes', { token: fornToken });
  assert(r.status === 200);
  assert(r.headers.get('X-Total-Count') != null, 'X-Total-Count ausente');
  assert(r.headers.get('X-Page') === '1', `X-Page=${r.headers.get('X-Page')}`);
  assert(r.headers.get('X-Per-Page') === '50', `X-Per-Page=${r.headers.get('X-Per-Page')}`);
  assert(r.headers.get('X-Total-Pages') != null);
  assert(r.json.paginacao, 'objeto paginacao ausente');
  assert(typeof r.json.paginacao.total === 'number');
});

await test('per_page=2 limita resposta a 2 itens', async () => {
  const r = await req('GET', '/api/notificacoes?per_page=2', { token: fornToken });
  assert(r.status === 200);
  assert(r.json.notificacoes.length <= 2, `recebeu ${r.json.notificacoes.length}`);
  assert(r.headers.get('X-Per-Page') === '2');
});

await test('page=2 retorna pagina diferente', async () => {
  const r1 = await req('GET', '/api/notificacoes?per_page=1&page=1', { token: fornToken });
  const r2 = await req('GET', '/api/notificacoes?per_page=1&page=2', { token: fornToken });
  if (r1.json.notificacoes.length && r2.json.notificacoes.length) {
    assert(r1.json.notificacoes[0].id !== r2.json.notificacoes[0].id, 'paginas devem trazer ids diferentes');
  }
  assert(r2.headers.get('X-Page') === '2');
});

await test('per_page maior que MAX (200) eh clampado', async () => {
  const r = await req('GET', '/api/notificacoes?per_page=999', { token: fornToken });
  assert(r.status === 200);
  assert(r.headers.get('X-Per-Page') === '200', `X-Per-Page=${r.headers.get('X-Per-Page')}`);
});

await test('per_page=0 ou negativo cai para minimo 1', async () => {
  const r = await req('GET', '/api/notificacoes?per_page=0', { token: fornToken });
  assert(r.status === 200);
  assert(r.headers.get('X-Per-Page') === '1');
});

await test('header Link inclui rel=first/last/next quando aplicavel', async () => {
  const r = await req('GET', '/api/notificacoes?per_page=1&page=1', { token: fornToken });
  const link = r.headers.get('Link') || '';
  assert(link.includes('rel="first"'), `link=${link}`);
  assert(link.includes('rel="last"'), `link=${link}`);
  const total = parseInt(r.headers.get('X-Total-Count') || '0');
  if (total > 1) assert(link.includes('rel="next"'), `esperava rel=next, link=${link}`);
});

await test('modo legado: ?limit= e ?offset= ainda funcionam (compat)', async () => {
  const r = await req('GET', '/api/notificacoes?limit=2&offset=0', { token: fornToken });
  assert(r.status === 200);
  assert(r.json.notificacoes.length <= 2);
  assert(r.headers.get('X-Per-Page') === '2', `per_page=${r.headers.get('X-Per-Page')}`);
});

await test('auditoria/sistema tambem usa paginacao padrao', async () => {
  const r = await req('GET', '/api/auditoria/sistema?per_page=3&page=1', { token: admToken });
  assert(r.status === 200);
  assert(r.headers.get('X-Total-Count') != null);
  assert(r.headers.get('X-Per-Page') === '3');
  assert(r.json.trilha.length <= 3);
  assert(r.json.paginacao);
});

await test('Access-Control-Expose-Headers inclui X-Total-Count e Link', async () => {
  const r = await req('GET', '/api/notificacoes', { token: fornToken });
  const exp = r.headers.get('Access-Control-Expose-Headers') || '';
  assert(exp.includes('X-Total-Count'), `expose=${exp}`);
  assert(exp.includes('X-Page'), `expose=${exp}`);
  assert(exp.includes('Link'), `expose=${exp}`);
});

console.log('\n========================================');
console.log(`Paginacao: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
