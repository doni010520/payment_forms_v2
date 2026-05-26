// =====================================================================
// V220: form-adapter.js agora intercepta click via clone+replace
// (antes monkey-patchava window.finalizeSubmission, que era inerte).
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

console.log('\n[Form adapter (V220)]');

let adapter;
await test('form-adapter.js serve 200', async () => {
  const r = await fetch(`${BASE}/app/form-adapter.js`);
  assert(r.status === 200, `status ${r.status}`);
  adapter = await r.text();
});

await test('todos 6 formulários incluem o adapter', async () => {
  const forms = ['formulario-hcc.html', 'formulario-hcc-servicos.html',
    'formulario-hcc-insumos.html', 'formulario-hcc-pgto-mao-obra.html',
    'formulario-hcc-pgto-servico.html', 'formulario-hcc-pgto-insumos.html'];
  for (const f of forms) {
    const r = await fetch(`${BASE}/${f}`);
    assert(r.status === 200, `${f}: status ${r.status}`);
    const text = await r.text();
    assert(/form-adapter\.js/.test(text), `${f} nao inclui form-adapter.js`);
  }
});

await test('adapter agora usa clone+replace do btnSubmit (V220 fix)', async () => {
  // bug antigo: window.finalizeSubmission = patched; handler do form usava
  // referencia local, ignorando o patch. Fix: cloneNode + replaceChild.
  assert(/cloneNode/.test(adapter), 'cloneNode ausente');
  assert(/replaceChild/.test(adapter), 'replaceChild ausente');
  // E o monkey-patch antigo NAO deve mais ser usado
  assert(!/window\.finalizeSubmission\s*=\s*async function patched/.test(adapter),
    'monkey-patch antigo ainda presente');
});

await test('adapter chama /api/envios/portal para usuario logado', async () => {
  assert(/\/api\/envios\/portal/.test(adapter));
});

await test('adapter chama /api/envios/publico/<token> para anonimo', async () => {
  assert(/\/api\/envios\/publico/.test(adapter));
});

await test('adapter trata cenario publico sem redirecionar para sucesso.html (que exige auth)', async () => {
  // sucesso.html chama api.envio(id) que precisa de token → quebra para anonimo.
  // adapter deve usar view-success local quando NAO tem token.
  assert(/getToken\(\)/.test(adapter) || /view-success/.test(adapter),
    'fallback para view-success local ausente');
});

await test('adapter trata erro do backend mostrando alert ao usuario', async () => {
  assert(/alert\(/.test(adapter));
  assert(/Não foi possível|nao foi possivel|Erro/i.test(adapter));
});

console.log('\n========================================');
console.log(`Form-adapter: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
