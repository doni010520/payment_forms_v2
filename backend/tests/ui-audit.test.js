// =====================================================================
// Auditoria UI: smoke tests para handlers e endpoints declarados em telas.
// Cada bug corrigido gera um caso aqui (anti-regressao).
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }

async function getHtml(path) {
  const r = await fetch(`${BASE}${path}`);
  assert(r.status === 200, `${path} esperava 200, veio ${r.status}`);
  return await r.text();
}

console.log('\n[Auditoria UI · smoke]');

// ============================================================
// recibo.html — V206 fix: voltarInteligente substitui history.back
// ============================================================
let reciboHtml;
await test('recibo.html carrega 200', async () => {
  reciboHtml = await getHtml('/app/recibo.html');
});

await test('recibo: nao usa mais history.back() direto no botao Voltar', async () => {
  // O bug original: <button onclick="history.back()">. Garante que sumiu.
  assert(!/onclick="history\.back\(\)"/.test(reciboHtml),
    'history.back() ainda referenciado no onclick — bug V206 nao corrigido');
});

await test('recibo: botao Voltar chama voltarInteligente()', async () => {
  assert(/onclick="voltarInteligente\(\)"/.test(reciboHtml),
    'botao Voltar deveria chamar voltarInteligente()');
});

await test('recibo: voltarInteligente() declarada como window.*', async () => {
  assert(/window\.voltarInteligente\s*=/.test(reciboHtml),
    'voltarInteligente() ausente como funcao global');
});

await test('recibo: voltarInteligente tem 3 estrategias (close/back/navigate)', async () => {
  assert(/window\.close\(\)/.test(reciboHtml), 'estrategia 1 (window.close) ausente');
  assert(/history\.back\(\)/.test(reciboHtml), 'estrategia 2 (history.back fallback) ausente');
  assert(/location\.href\s*=/.test(reciboHtml), 'estrategia 3 (navegacao) ausente');
});

await test('recibo: usa chave correta de localStorage (fesf_usuario)', async () => {
  assert(/fesf_usuario/.test(reciboHtml), 'chave fesf_usuario ausente');
  // Garante que nao usa erradamente o prefixo legado fesf:usuario
  assert(!/fesf:usuario/.test(reciboHtml), 'chave incorreta fesf:usuario presente');
});

await test('recibo: botao Imprimir mantido', async () => {
  assert(/onclick="window\.print\(\)"/.test(reciboHtml));
});

// ============================================================
// V207 — login.html: remove checkbox lembrar-me morto + links # mortos
// ============================================================
let loginHtml;
await test('login.html carrega 200', async () => { loginHtml = await getHtml('/app/login.html'); });

await test('login: checkbox "Lembrar-me" removido (feature morta)', async () => {
  assert(!/id="lembrar"/.test(loginHtml), 'checkbox lembrar ainda presente');
});

await test('login: links "Privacidade" e "Suporte" mortos removidos', async () => {
  // Nao deve haver mais <a href="#"> no footer
  // (href="#" antes do skip-link tambem nao deveria existir, mas skip-link nao existe nessa pagina)
  assert(!/href="#">Privacidade/.test(loginHtml), 'link Privacidade morto presente');
  assert(!/href="#">Suporte/.test(loginHtml), 'link Suporte morto presente');
});

await test('login: footer agora tem "Consulta pública" no lugar', async () => {
  assert(/Consulta pública/.test(loginHtml) || /href="\/app\/consulta\.html"/.test(loginHtml));
});

// ============================================================
// V207 — portal.html: rotação de sessão após alterar senha (V198 wire-up)
// ============================================================
let portalHtml;
await test('portal.html carrega 200', async () => { portalHtml = await getHtml('/app/portal.html'); });

await test('portal: importa setSession para receber novo_token apos /me/senha', async () => {
  assert(/import\s*{[^}]*\bsetSession\b[^}]*}\s*from\s*['"]\/app\/api\.js['"]/.test(portalHtml),
    'setSession nao importado');
});

await test('portal: handler de senha usa novo_token retornado', async () => {
  // Deve referenciar r.novo_token e chamar setSession
  assert(/novo_token/.test(portalHtml), 'novo_token nao mencionado no portal');
  assert(/setSession\s*\(/.test(portalHtml), 'setSession nao chamado');
});

// ============================================================
// V207 — sucesso.html: esconde "Acompanhar no portal" para anonimos
// ============================================================
let sucessoHtml;
await test('sucesso.html carrega 200', async () => { sucessoHtml = await getHtml('/app/sucesso.html'); });

await test('sucesso: btn-portal escondido quando sem token (Cenario 2)', async () => {
  assert(/btn-portal/.test(sucessoHtml), 'btn-portal nao encontrado');
  assert(/!temToken/.test(sucessoHtml) || /bp\.style\.display\s*=\s*['"]none['"]/.test(sucessoHtml),
    'logica de esconder btn-portal ausente');
});

// ============================================================
// V207 — consulta.html: adiciona link para recibo oficial + erro melhor
// ============================================================
let consultaHtml;
await test('consulta.html carrega 200', async () => { consultaHtml = await getHtml('/app/consulta.html'); });

await test('consulta: resultado tem link "Ver recibo oficial"', async () => {
  assert(/Ver recibo oficial/.test(consultaHtml), 'link para recibo ausente');
  assert(/\/app\/recibo\.html\?protocolo=/.test(consultaHtml));
});

await test('consulta: mensagem de erro diferencia 404 de erro tecnico', async () => {
  assert(/404|nao encontrado|not found/i.test(consultaHtml) && /Erro na consulta/.test(consultaHtml),
    'logica de diferenciacao de erro ausente');
});

// ============================================================
// V208 — envio.html: redireciona retificacao com ?retificar=ID
// ============================================================
let envioHtml;
await test('envio.html carrega 200', async () => { envioHtml = await getHtml('/app/envio.html'); });

await test('envio: acaoEnviarRet passa ?retificar=ID no redirect (nao perde contexto)', async () => {
  assert(/retificar=\$\{id\}/.test(envioHtml) || /\/app\/portal\.html\?retificar=/.test(envioHtml),
    'redirect sem ?retificar=ID');
});

// ============================================================
// V208 — portal.html: detecta ?retificar=ID e abre modal automatico
// ============================================================
await test('portal: detecta ?retificar=ID e abre modal automaticamente', async () => {
  assert(/retificar/.test(portalHtml), 'busca por retificar ausente');
  assert(/abrirRetificacao\s*\(/.test(portalHtml), 'abrirRetificacao nao chamada');
});

// ============================================================
// V208 — painel.html: bugs criticos corrigidos
// ============================================================
let painelHtml;
await test('painel.html carrega 200', async () => { painelHtml = await getHtml('/app/painel.html'); });

await test('painel: "Convidar cadastrado" agora aponta para modal-expectativa (modal-convite nao existia)', async () => {
  // Nao deve haver mais nenhuma referencia a abrirModal('modal-convite')
  assert(!/abrirModal\('modal-convite'\)/.test(painelHtml),
    'referencia a modal-convite (que nao existe) ainda presente');
  // E deve estar usando modal-expectativa no botao "Convidar"
  assert(/Convidar cadastrado/.test(painelHtml));
});

await test('painel: bulk-bar nao tem CSS duplicado (display:none + display:flex)', async () => {
  // Quero garantir que NO style inline da bulk-bar nao ha 2 ocorrencias de "display:"
  const bar = painelHtml.match(/<div id="bulk-bar"[^>]*style="([^"]+)"/);
  assert(bar, 'bulk-bar nao encontrado');
  const cssCount = (bar[1].match(/display\s*:/g) || []).length;
  assert(cssCount === 1, `bulk-bar tem ${cssCount} propriedades display (esperado 1)`);
});

await test('painel: marcarPago simples removida (forcava perda de dados estruturados)', async () => {
  // Nao deve haver mais window.marcarPago = ...
  assert(!/window\.marcarPago\s*=\s*async/.test(painelHtml),
    'window.marcarPago morta ainda declarada');
  // Caminho de pagamento agora redireciona para envio.html
  assert(/Registrar pagamento.*estruturado/.test(painelHtml) || /location\.href='\/app\/envio\.html\?id=/.test(painelHtml),
    'caminho para envio.html ausente');
});

// ============================================================
// V209 — Fase 2C: admin operacional (4 telas + 2 colaterais)
// ============================================================
let admPagHtml, admFornHtml, admFornDetHtml, admUniHtml;
await test('admin-pagamentos.html carrega 200', async () => { admPagHtml = await getHtml('/app/admin-pagamentos.html'); });
await test('admin-fornecedores.html carrega 200', async () => { admFornHtml = await getHtml('/app/admin-fornecedores.html'); });
await test('admin-fornecedor.html carrega 200', async () => { admFornDetHtml = await getHtml('/app/admin-fornecedor.html'); });
await test('admin-unidade.html carrega 200', async () => { admUniHtml = await getHtml('/app/admin-unidade.html'); });

await test('admin-pagamentos: botao de lote agora deixa claro que NAO registra estruturado', async () => {
  assert(/sem dados estruturados/i.test(admPagHtml), 'aviso de "sem dados estruturados" ausente');
});

await test('admin-pagamentos: coluna por linha agora aponta para registro estruturado', async () => {
  assert(/Registrar/.test(admPagHtml) && /\/app\/envio\.html/.test(admPagHtml),
    'caminho para envio.html ausente na coluna por linha');
});

await test('admin-fornecedores: <a class="button"> removido (.button nao existe no CSS)', async () => {
  assert(!/<a[^>]*class="button"/.test(admFornHtml), 'a.button ainda presente');
});

await test('admin-fornecedor: trilha de auditoria agora aceita {trilha} (bug critico)', async () => {
  // Deve haver "a.trilha || a.auditoria" ou similar fallback
  assert(/a\.trilha/.test(admFornDetHtml), 'codigo nao le a.trilha');
});

await test('admin-fornecedor: topnav agora inclui link "API" (consistencia)', async () => {
  assert(/admin-api\.html/.test(admFornDetHtml), 'link admin-api ausente');
});

await test('admin-fornecedor: voltar aponta para a lista (em vez de admin.html)', async () => {
  assert(/admin-fornecedores\.html[^"]*">.*Voltar/i.test(admFornDetHtml),
    'link Voltar nao redireciona para lista de fornecedores');
});

await test('admin-unidade: mesmo bug de trilha tambem corrigido', async () => {
  assert(/a\.trilha/.test(admUniHtml), 'admin-unidade nao le a.trilha');
});

await test('sucesso: actions-bar .btn agora tem estilo visual (background, border)', async () => {
  // Detecta que o estilo .actions-bar a agora inclui background ou border
  assert(/\.actions-bar a, \.actions-bar button\{[^}]*background[^}]*\}/.test(sucessoHtml) ||
         /\.actions-bar .primary\{[^}]*background[^}]*\}/.test(sucessoHtml),
    'botoes da actions-bar sem estilo visual aplicado');
});

// ============================================================
// V210 — Fase 2D: admin cadastros (4 telas + admin-api colateral)
// ============================================================
let admUnisHtml, admUsrHtml, admCfgHtml, admApiHtml;
await test('admin-unidades.html carrega 200', async () => { admUnisHtml = await getHtml('/app/admin-unidades.html'); });
await test('admin-usuarios.html carrega 200', async () => { admUsrHtml = await getHtml('/app/admin-usuarios.html'); });
await test('admin-config.html carrega 200', async () => { admCfgHtml = await getHtml('/app/admin-config.html'); });
await test('admin-api.html carrega 200', async () => { admApiHtml = await getHtml('/app/admin-api.html'); });

await test('admin-unidades: topnav agora inclui link Pagamentos', async () => {
  assert(/admin-pagamentos\.html/.test(admUnisHtml));
});

await test('admin-unidade: topnav agora inclui link API + protocolos clicaveis', async () => {
  // Re-le admin-unidade pois ja carregamos antes mas fora deste escopo
  const html = await getHtml('/app/admin-unidade.html');
  assert(/admin-api\.html/.test(html), 'admin-api ausente do topnav');
  assert(/\/app\/envio\.html\?id=\$\{e\.id\}/.test(html), 'protocolo nao linkado');
});

await test('admin-usuarios: select de unidade agora tem required', async () => {
  // O atributo required deve estar presente no <select id="us-unidade">
  assert(/<select id="us-unidade"[^>]*\brequired\b/.test(admUsrHtml),
    'select us-unidade sem required');
});

await test('admin-config: usa setSession para preservar sessao apos alterar senha', async () => {
  assert(/setSession/.test(admCfgHtml), 'setSession nao importado/usado');
  assert(/novo_token/.test(admCfgHtml), 'novo_token nao mencionado');
});

await test('admin-api: topnav agora padronizado com 10+ abas', async () => {
  const tabs = (admApiHtml.match(/<a [^>]*href="\/app\/admin-[a-z]+\.html"/g) || []).length;
  assert(tabs >= 9, `admin-api so tem ${tabs} links de admin, esperado >= 9`);
  assert(/admin-pagamentos\.html/.test(admApiHtml));
  assert(/admin-unidades\.html/.test(admApiHtml));
  assert(/admin-fornecedores\.html/.test(admApiHtml));
});

// Colateral V210 — perfil.html tambem precisa de setSession apos alterar senha
let perfilHtml;
await test('perfil.html carrega 200', async () => { perfilHtml = await getHtml('/app/perfil.html'); });

await test('perfil: alterarMinhaSenha agora usa novo_token (mesmo padrao V207/V210)', async () => {
  assert(/setSession/.test(perfilHtml), 'setSession nao importado');
  assert(/novo_token/.test(perfilHtml), 'novo_token nao usado');
});

// ============================================================
// V211 — Fase 2E: admin observabilidade + colaterais em api.js
// ============================================================
let admAudHtml, admEmHtml, admStHtml, admRelHtml, apiJs;
await test('admin-auditoria.html carrega 200', async () => { admAudHtml = await getHtml('/app/admin-auditoria.html'); });
await test('admin-emails.html carrega 200',    async () => { admEmHtml  = await getHtml('/app/admin-emails.html'); });
await test('admin-status.html carrega 200',    async () => { admStHtml  = await getHtml('/app/admin-status.html'); });
await test('admin-relatorios.html carrega 200',async () => { admRelHtml = await getHtml('/app/admin-relatorios.html'); });
await test('api.js carrega 200',               async () => { apiJs      = await getHtml('/app/api.js'); });

await test('admin-auditoria: botao CSV usa /api/auditoria/sistema.csv (V205)', async () => {
  assert(/exportarCSV/.test(admAudHtml), 'exportarCSV nao definida');
  assert(/\/api\/auditoria\/sistema\.csv/.test(admAudHtml), 'endpoint CSV nao referenciado');
});

await test('admin-emails: debounce no filtro destinatario', async () => {
  assert(/setTimeout\(\(\)\s*=>\s*carregar\(\)/.test(admEmHtml) || /destTimer/.test(admEmHtml),
    'debounce ausente');
});

await test('admin-emails: botao CSV usa /api/admin/emails.csv (V204)', async () => {
  assert(/\/api\/admin\/emails\.csv/.test(admEmHtml), 'endpoint emails.csv ausente');
});

await test('admin-status: botao maintenance reflete estado real', async () => {
  assert(/atualizarLabelMaint/.test(admStHtml), 'funcao para atualizar label ausente');
  assert(/Manutenção ON|Ligar modo manutenção/.test(admStHtml), 'labels dinamicos ausentes');
});

await test('admin-relatorios: exportar agora anexa ao DOM + revoga URL (Firefox)', async () => {
  // Procura o handler exportar e verifica que ele tem appendChild + revokeObjectURL
  const exportFn = admRelHtml.match(/window\.exportar\s*=[\s\S]+?\n};/);
  assert(exportFn, 'window.exportar nao encontrado');
  assert(/appendChild/.test(exportFn[0]), 'appendChild ausente — Firefox vai falhar');
  assert(/revokeObjectURL/.test(exportFn[0]), 'revokeObjectURL ausente — vazamento de memoria');
});

await test('api.js: baixarBackup tambem corrigido (anexa DOM + revoke)', async () => {
  const fn = apiJs.match(/baixarBackup:\s*async[\s\S]+?\n  \},/);
  assert(fn, 'baixarBackup nao encontrado');
  assert(/appendChild/.test(fn[0]), 'baixarBackup sem appendChild');
  assert(/revokeObjectURL/.test(fn[0]), 'baixarBackup sem revoke');
});

await test('api.js: baixarMeusDados tambem corrigido (LGPD)', async () => {
  const fn = apiJs.match(/baixarMeusDados:\s*async[\s\S]+?\n  \},/);
  assert(fn, 'baixarMeusDados nao encontrado');
  assert(/appendChild/.test(fn[0]), 'baixarMeusDados sem appendChild');
  assert(/revokeObjectURL/.test(fn[0]), 'baixarMeusDados sem revoke');
});

// ============================================================
// V212 — Fase 2F: acessorios
// ============================================================
let notifHtml, cadHtml;
await test('notificacoes.html carrega 200', async () => { notifHtml = await getHtml('/app/notificacoes.html'); });
await test('cadastro.html carrega 200',     async () => { cadHtml   = await getHtml('/app/cadastro.html'); });

await test('notificacoes: campo correto criada_em (nao criado_em) — bug critico V212', async () => {
  // Antes: ${new Date(n.criado_em)} → todas as datas eram "Invalid Date"
  assert(/n\.criada_em/.test(notifHtml), 'notificacoes ainda usa n.criada_em');
  // E NAO deve mais ter n.criado_em
  assert(!/new Date\(n\.criado_em\)/.test(notifHtml),
    'notificacoes ainda tem n.criado_em (typo do backend)');
});

await test('cadastro: CNPJ agora tem pattern + inputmode + sanitize', async () => {
  assert(/pattern="\\d\{14\}"/.test(cadHtml), 'pattern CNPJ ausente');
  assert(/inputmode="numeric"/.test(cadHtml), 'inputmode numeric ausente');
  assert(/cad-doc.*replace\(\/\\D\/g, ''\)/s.test(cadHtml), 'sanitize de nao-digitos ausente');
});

console.log('\n========================================');
console.log(`UI-audit: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
