// =====================================================================
// V230 / O1 — SLA visual + hotkeys de triagem
//
// Cobertura: como SLA e hotkeys são frontend puro (sem novos endpoints
// no backend), os testes verificam:
//   - Configuração `sla_dias_aprovacao` tem default no backend
//   - painel.html tem coluna "SLA" e função slaCell
//   - painel.html tem handler de hotkeys J/K/Enter/?
//   - envio.html tem hotkeys A/R/C
//   - Modal de ajuda existente em ambas as páginas
//   - Botão de ajuda no header do painel
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function get(path, opts={}) {
  const r = await fetch(`${BASE}${path}`, opts);
  return { status: r.status, text: await r.text() };
}

console.log('\n[SLA + hotkeys — V230/O1]');

await test('config sla_dias_aprovacao tem default no backend', async () => {
  // Login admin
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'maria.andrade@fesfsus.ba.gov.br', senha: 'senha123' }),
  });
  const j = await login.json();
  const r = await fetch(`${BASE}/api/configuracoes`, {
    headers: { Authorization: 'Bearer ' + j.token },
  });
  const cfg = (await r.json()).configuracoes;
  assert(typeof cfg.sla_dias_aprovacao === 'number' && cfg.sla_dias_aprovacao > 0,
    `default sla_dias_aprovacao: ${cfg.sla_dias_aprovacao}`);
});

await test('painel.html: coluna SLA presente', async () => {
  const r = await get('/app/painel.html');
  assert(r.status === 200);
  assert(/<th[^>]*>SLA<\/th>/.test(r.text), 'coluna SLA não encontrada no thead');
  assert(/slaCell/.test(r.text), 'função slaCell não encontrada');
});

await test('painel.html: handler de hotkeys (J/K/Enter/?)', async () => {
  const r = await get('/app/painel.html');
  assert(/keydown/.test(r.text), 'sem listener keydown');
  // verifica que as 4 teclas estão no handler
  for (const k of ['j', 'k', '?', 'Enter']) {
    const re = new RegExp("ev\\.key === ['\"]" + (k === '?' ? '\\?' : k) + "['\"]");
    assert(re.test(r.text), `tecla "${k}" não está mapeada`);
  }
});

await test('painel.html: função abrirAjudaHotkeys + modal-hotkeys', async () => {
  const r = await get('/app/painel.html');
  assert(/abrirAjudaHotkeys/.test(r.text), 'sem função abrirAjudaHotkeys');
  assert(/modal-hotkeys/.test(r.text), 'sem modal-hotkeys');
});

await test('painel.html: botão de atalhos no header (⌨)', async () => {
  const r = await get('/app/painel.html');
  assert(/btnHotkeys|abrirAjudaHotkeys\(\)/.test(r.text), 'sem botão de atalhos');
});

await test('envio.html: hotkeys A/R/C presentes', async () => {
  const r = await get('/app/envio.html');
  for (const k of ['a', 'r', 'c']) {
    const re = new RegExp("ev\\.key === ['\"]" + k + "['\"]");
    assert(re.test(r.text), `tecla "${k}" não está mapeada em envio.html`);
  }
  // Esc fecha modal aberto
  assert(/ev\.key === ['"]Escape['"]/.test(r.text), 'sem handler de Escape');
});

await test('envio.html: hotkeys chamam acaoAprovar / acaoSolicitarRet / coment-txt', async () => {
  const r = await get('/app/envio.html');
  assert(/acaoAprovar\(\)/.test(r.text));
  assert(/acaoSolicitarRet\(\)/.test(r.text));
  assert(/coment-txt/.test(r.text));
});

await test('envio.html: modal de ajuda local + função _hkEnvioAjuda', async () => {
  const r = await get('/app/envio.html');
  assert(/_hkEnvioAjuda/.test(r.text), 'sem função _hkEnvioAjuda');
  assert(/modal-hotkeys-envio/.test(r.text), 'sem modal-hotkeys-envio');
});

await test('hotkeys: ignoram input/textarea/select (sem trigger acidental)', async () => {
  const painel = (await get('/app/painel.html')).text;
  const envio = (await get('/app/envio.html')).text;
  // Ambas as páginas devem ter check de tag para evitar trigger em forms
  assert(/input.*textarea.*select|textarea.*input|isContentEditable/.test(painel),
    'painel: hotkeys não filtram inputs');
  assert(/input.*textarea.*select|textarea.*input|isContentEditable/.test(envio),
    'envio: hotkeys não filtram inputs');
});

console.log('\n========================================');
console.log(`SLA + hotkeys: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
