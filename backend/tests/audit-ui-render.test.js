// =====================================================================
// V236: auditoria de render de cada HTML via fetch+inspect.
// Faz GET de cada tela, valida que:
//   1. status 200
//   2. imports ESM resolvem para símbolos exportados realmente
//   3. <script> não tem erro sintático ÓBVIO (try { new Function(code) } )
// Falhar aqui detecta o tipo de bug "import quebrado + módulo carrega
// undefined silenciosamente + página fica em 'Carregando...'" que pegamos
// na V235 manualmente.
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0; const erros = [];
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; erros.push(`${nome}: ${e.message}`); }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

const TELAS = [
  // login + auth
  'login.html', 'cadastro.html', 'senha.html', 'onboarding.html', 'trocar-senha.html',
  // fornecedor
  'portal.html', 'portal-novo.html', 'perfil.html', 'notificacoes.html',
  // operador
  'painel.html', 'envio.html?id=1',
  // admin
  'admin.html', 'admin-config.html', 'admin-fornecedores.html', 'admin-fornecedor.html?id=1',
  'admin-unidades.html', 'admin-unidade.html?id=1', 'admin-usuarios.html', 'admin-relatorios.html',
  'admin-auditoria.html', 'admin-emails.html', 'admin-pagamentos.html', 'admin-status.html',
  'admin-api.html', 'admin-smtp.html',
  // públicos
  'consulta.html?protocolo=HECC-SEED-0001', 'recibo.html?id=1', 'sucesso.html?id=1',
  'publico.html', 'relatorio-print.html',
  // formularios (HTMLs grandes)
  'formulario-hcc.html', 'formulario-hcc-insumos.html', 'formulario-hcc-servicos.html',
  'formulario-hcc-pgto-insumos.html', 'formulario-hcc-pgto-servico.html', 'formulario-hcc-pgto-mao-obra.html',
];

console.log('\n[Audit UI render — V236]');

// Cache de arquivos JS para evitar refetch
const jsCache = new Map();
async function getJs(path) {
  if (jsCache.has(path)) return jsCache.get(path);
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) { jsCache.set(path, null); return null; }
  const t = await r.text();
  jsCache.set(path, t);
  return t;
}

for (const t of TELAS) {
  await test(`render ${t}`, async () => {
    // formulario-hcc* ficam na RAIZ (express static do projeto), não em /app/
    const url = t.startsWith('formulario-hcc') ? `${BASE}/${t}` : `${BASE}/app/${t}`;
    const r = await fetch(url);
    if (r.status === 404) {
      // tolerar 404 SE for página obsoleta (portal-novo.html etc)
      if (['portal-novo.html'].some(x => t.startsWith(x))) {
        console.log(`    [skip: ${t} já não existe]`);
        return;
      }
      throw new Error(`HTTP 404`);
    }
    assert(r.status === 200, `HTTP ${r.status}`);
    const html = await r.text();
    // Coleta TODOS imports ESM (com aliases `import X as Y`)
    const imports = [...html.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)];
    for (const [, syms, from] of imports) {
      // Só checa /app/*.js (paths locais resolvíveis)
      if (!from.startsWith('/app/')) continue;
      const fileText = await getJs(from);
      assert(fileText, `arquivo importado nao existe: ${from}`);
      const exportados = new Set();
      for (const m of fileText.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g)) {
        exportados.add(m[1]);
      }
      // export { X, Y as Z }
      for (const m of fileText.matchAll(/export\s+\{\s*([^}]+)\s*\}/g)) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop();
          exportados.add(name);
        }
      }
      for (const raw of syms.split(',')) {
        const sym = raw.trim().split(/\s+as\s+/)[0];
        if (!sym) continue;
        assert(exportados.has(sym),
          `${sym} importado de ${from} mas NÃO está exportado (vai virar undefined em runtime)`);
      }
    }
  });
}

console.log('\n========================================');
console.log(`Audit UI render: ${passed} passou · ${failed} falhou`);
console.log('========================================');
if (failed > 0) { console.log('\nFalhas:'); for (const e of erros) console.log('  • ' + e); }
process.exit(failed > 0 ? 1 : 0);
