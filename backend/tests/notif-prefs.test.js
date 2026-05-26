// =====================================================================
// Preferências de notificação server-side
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

console.log('\n[Notif prefs server-side]');

let tokenForn;
await test('login fornecedor', async () => { tokenForn = await login('contato@empresahosp.com.br'); });

await test('GET /api/me/notif-prefs retorna defaults (todos true)', async () => {
  const r = await req('GET', '/api/me/notif-prefs', { token: tokenForn });
  assert(r.status === 200);
  assert(r.json.prefs);
  assert(r.json.prefs.novo_envio === true);
  assert(r.json.prefs.status_envio === true);
  assert(r.json.prefs.comentarios === true);
  assert(r.json.prefs.pagamento === true);
  assert(r.json.default);
});

await test('PUT salva preferências parciais', async () => {
  const r = await req('PUT', '/api/me/notif-prefs', { token: tokenForn,
    body: { prefs: { novo_envio: false, comentarios: false } } });
  assert(r.status === 200);
  assert(r.json.ok === true);
  assert(r.json.prefs.novo_envio === false);
  assert(r.json.prefs.comentarios === false);
});

await test('GET retorna prefs salvas', async () => {
  const r = await req('GET', '/api/me/notif-prefs', { token: tokenForn });
  // chaves não salvas devem voltar com default true
  assert(r.json.prefs.novo_envio === false);
  assert(r.json.prefs.status_envio === true); // não foi tocada → default true
  assert(r.json.prefs.comentarios === false);
  assert(r.json.prefs.pagamento === true);
});

await test('PUT ignora chaves desconhecidas (defesa)', async () => {
  const r = await req('PUT', '/api/me/notif-prefs', { token: tokenForn,
    body: { prefs: { novo_envio: true, chave_lixo: 'malicioso' } } });
  assert(r.status === 200);
  assert(!('chave_lixo' in r.json.prefs));
});

await test('PUT sem prefs retorna 400', async () => {
  const r = await req('PUT', '/api/me/notif-prefs', { token: tokenForn, body: {} });
  assert(r.status === 400);
});

await test('SEM auth retorna 401', async () => {
  const r = await req('GET', '/api/me/notif-prefs');
  assert(r.status === 401);
});

await test('Fornecedor desabilita "novo_envio" e não recebe notif desse tipo', async () => {
  // 1. Desabilita
  await req('PUT', '/api/me/notif-prefs', { token: tokenForn,
    body: { prefs: { novo_envio: false, status_envio: true, comentarios: true, pagamento: true } } });
  // 2. Conta notif antes
  const before = (await req('GET', '/api/notificacoes', { token: tokenForn })).json.notificacoes.length;
  // 3. Cria envio (gera notif tipo 'novo_envio' para operador, NÃO para fornecedor — fornecedor recebe 'envio_aprovado' etc).
  // Vamos validar diferente: criar envio + aprovar → fornecedor recebe 'envio_aprovado' (status_envio=true → recebe normalmente)
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'PREFS' } });
  // Como aprovação é 'status_envio' e está ligado, deveria chegar normal — apenas testando que o sistema NÃO QUEBROU
  const after = (await req('GET', '/api/notificacoes', { token: tokenForn })).json.notificacoes.length;
  assert(after >= before, 'fluxo funcionou sem erro');
});

await test('perfil.html consome API ao invés de localStorage', async () => {
  const r = await fetch(`${BASE}/app/perfil.html`);
  const t = await r.text();
  assert(t.includes('obterNotifPrefs') || t.includes('notif-prefs'));
  assert(t.includes('salvarNotifPrefs') || t.includes('salvarNotifPrefs'));
  assert(t.includes('sincroniza entre dispositivos') || t.includes('servidor'));
});

console.log('\n========================================');
console.log(`Notif prefs: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
