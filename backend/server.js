// =====================================================================
// Portal de Pagamentos FESF · servidor Express
// =====================================================================
// V239 fix TZ-DB: força process.env.TZ='UTC' antes de qualquer import que
// inicialize PGlite. PGlite armazena TIMESTAMP (sem TZ) interpretando o
// CURRENT_TIMESTAMP como wall-clock do process. Em hosts em timezone
// não-UTC (ex.: America/Bahia) isso gerava drift de 3h em criado_em vs
// new Date() do JS — visível no recibo (V237 R1) e SLA -1 dias (V235).
// Com TZ=UTC garantimos que todos os timestamps são UTC consistente.
if (!process.env.TZ) process.env.TZ = 'UTC';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './db/seed.js';
import authRoutes from './routes/auth.js';
import envioRoutes from './routes/envios.js';
import linkRoutes from './routes/links.js';
import expectativaRoutes from './routes/expectativas.js';
import diretosRoutes from './routes/diretos.js';
import notificacaoRoutes from './routes/notificacoes.js';
import metricasRoutes from './routes/metricas.js';
import fornecedorRoutes from './routes/fornecedores.js';
import adminCrudRoutes from './routes/admin-crud.js';
import searchRoutes from './routes/search.js';
import smtpRoutes from './routes/smtp.js';
import clientErrorRoutes from './routes/client-errors.js'; // V291: captura de erros do cliente
import storageRoutes from './routes/storage.js'; // V292: OneDrive/SharePoint config
import fornecedorDocumentosRoutes from './routes/fornecedor-documentos.js'; // documentos fixos do fornecedor
import certidoesRoutes from './routes/certidoes.js'; // alertas de validade de certidoes
import { executarEscalonamento } from './services/expectativa-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '10mb' }));

// Gzip compression — comprime JSON/HTML quando cliente envia Accept-Encoding: gzip
// Threshold de 1KB (não comprime payloads pequenos, overhead não compensa).
// Skip via header X-No-Compression (útil para debug).
import compression from 'compression';
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// Modo manutenção — admin pode bloquear writes durante upgrades sem derrubar reads
// Flag em configuracoes.maintenance_mode (cache 5s para evitar query por request)
let _maintCache = { value: false, until: 0 };
async function isMaintenance() {
  if (Date.now() < _maintCache.until) return _maintCache.value;
  let value = false;
  try {
    const { queryOne } = await import('./db/index.js');
    const r = await queryOne(`SELECT valor FROM configuracoes WHERE chave='maintenance_mode'`);
    if (r) {
      try { value = JSON.parse(r.valor) === true; } catch {}
    }
  } catch {}
  _maintCache = { value, until: Date.now() + 5000 };
  return value;
}
const MAINT_MESSAGE = 'Sistema em modo manutencao';
// Middleware 1: anuncia manutencao em TODA resposta (header) — front mostra banner imediato
app.use(async (req, res, next) => {
  try {
    if (await isMaintenance()) {
      res.setHeader('X-Maintenance', '1');
      res.setHeader('X-Maintenance-Message', MAINT_MESSAGE);
    }
  } catch { /* nao bloqueia request se DB cair */ }
  next();
});
// Middleware 2: bloqueia writes (logica anterior preservada)
app.use(async (req, res, next) => {
  // Métodos seguros e endpoints whitelist sempre passam
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/auth/login')) return next();
  if (req.path.startsWith('/api/configuracoes')) return next();  // p/ admin tirar manutenção
  if (req.path.startsWith('/api/health')) return next();
  if (await isMaintenance()) {
    res.setHeader('Retry-After', '60');
    return res.status(503).json({ error: 'Sistema em modo manutenção · writes temporariamente bloqueados', maintenance: true });
  }
  next();
});

// Request timeout — fecha conexão se request demorar mais que REQUEST_TIMEOUT_MS (default 30s)
// Uploads e relatórios pesados podem precisar de mais; configurar via env em prod.
// O 504 Gateway Timeout é o status correto (vs 408 que é client-side).
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;
app.use((req, res, next) => {
  // Bypass para downloads grandes (configurável depois)
  if (req.path.includes('/download') || req.path.includes('/preview')) return next();
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(504).json({ error: `Request excedeu timeout de ${REQUEST_TIMEOUT_MS}ms` });
    } else {
      // Conexão já estava streaming; força fechar
      res.end();
    }
  });
  next();
});

// Métricas Prometheus — counters in-memory, exposto em /metrics
const _metrics = {
  requests: new Map(), // key: "method|path_template|status" -> count
  durations: { sum: 0, count: 0, buckets: { 50: 0, 100: 0, 250: 0, 500: 0, 1000: 0, 5000: 0, inf: 0 } },
  start_time: Date.now(),
};
function pathTemplate(p) {
  // Normaliza: /api/envios/123 → /api/envios/:id (evita explosão de cardinalidade)
  return p.replace(/\/\d+/g, '/:id').replace(/\/[a-f0-9-]{30,}/gi, '/:token');
}
function bumpMetric(method, path, status, dur) {
  const k = `${method}|${pathTemplate(path)}|${status}`;
  _metrics.requests.set(k, (_metrics.requests.get(k) || 0) + 1);
  _metrics.durations.sum += dur;
  _metrics.durations.count++;
  const b = _metrics.durations.buckets;
  if (dur <= 50) b[50]++;
  if (dur <= 100) b[100]++;
  if (dur <= 250) b[250]++;
  if (dur <= 500) b[500]++;
  if (dur <= 1000) b[1000]++;
  if (dur <= 5000) b[5000]++;
  b.inf++;
}

// Endpoint /metrics (formato Prometheus text/plain)
app.get('/metrics', (_, res) => {
  const lines = [];
  lines.push('# HELP fesf_up Indica que o servidor está rodando');
  lines.push('# TYPE fesf_up gauge');
  lines.push('fesf_up 1');
  lines.push('# HELP fesf_uptime_seconds Uptime do processo em segundos');
  lines.push('# TYPE fesf_uptime_seconds counter');
  lines.push(`fesf_uptime_seconds ${Math.floor((Date.now() - _metrics.start_time) / 1000)}`);
  lines.push('# HELP fesf_requests_total Total de requisições HTTP');
  lines.push('# TYPE fesf_requests_total counter');
  for (const [k, v] of _metrics.requests) {
    const [method, path, status] = k.split('|');
    lines.push(`fesf_requests_total{method="${method}",path="${path}",status="${status}"} ${v}`);
  }
  lines.push('# HELP fesf_request_duration_ms Latência das requisições em ms');
  lines.push('# TYPE fesf_request_duration_ms histogram');
  const b = _metrics.durations.buckets;
  lines.push(`fesf_request_duration_ms_bucket{le="50"} ${b[50]}`);
  lines.push(`fesf_request_duration_ms_bucket{le="100"} ${b[100]}`);
  lines.push(`fesf_request_duration_ms_bucket{le="250"} ${b[250]}`);
  lines.push(`fesf_request_duration_ms_bucket{le="500"} ${b[500]}`);
  lines.push(`fesf_request_duration_ms_bucket{le="1000"} ${b[1000]}`);
  lines.push(`fesf_request_duration_ms_bucket{le="5000"} ${b[5000]}`);
  lines.push(`fesf_request_duration_ms_bucket{le="+Inf"} ${b.inf}`);
  lines.push(`fesf_request_duration_ms_sum ${_metrics.durations.sum}`);
  lines.push(`fesf_request_duration_ms_count ${_metrics.durations.count}`);
  lines.push('# HELP nodejs_memory_bytes Uso de memória do processo (heap usado)');
  lines.push('# TYPE nodejs_memory_bytes gauge');
  const mem = process.memoryUsage();
  lines.push(`nodejs_memory_bytes{type="heap_used"} ${mem.heapUsed}`);
  lines.push(`nodejs_memory_bytes{type="heap_total"} ${mem.heapTotal}`);
  lines.push(`nodejs_memory_bytes{type="rss"} ${mem.rss}`);
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n') + '\n');
});

// Request ID + structured JSON logging (compatível com Loki/Datadog/CloudWatch)
// Em testes: setar LOG_QUIET=1 para silenciar. Em prod: pipe pra agregador.
import { randomUUID } from 'node:crypto';
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const t0 = Date.now();
  res.on('finish', () => {
    // Usa originalUrl (path completo incluindo mount), remove query string
    const fullPath = (req.originalUrl || req.url || req.path).split('?')[0];
    bumpMetric(req.method, fullPath, res.statusCode, Date.now() - t0);
    if (process.env.LOG_QUIET === '1') return;
    // Não loga health endpoints (ruído de uptime checks)
    if (req.path === '/api/health' || req.path === '/api/health/detailed') return;
    const log = {
      ts: new Date().toISOString(),
      req_id: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - t0,
      ip: req.ip || req.connection?.remoteAddress,
      ua: (req.headers['user-agent'] || '').substring(0, 80),
    };
    // Erro = stderr, sucesso = stdout
    if (res.statusCode >= 500) console.error(JSON.stringify(log));
    else console.log(JSON.stringify(log));
  });
  next();
});

// CORS — configurável via CORS_ALLOWED_ORIGINS (preferido) ou CORS_ORIGINS (alias legado)
// Separado por vírgula; '*' libera tudo (não recomendado em produção).
// Suporte a wildcard de subdomínio: '*.fesfsus.ba.gov.br'
const CORS_RAW = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '*';
const CORS_ORIGINS = CORS_RAW.split(',').map(s => s.trim()).filter(Boolean);
const CORS_WILDCARD = CORS_ORIGINS.includes('*');
// Warning explícito se rodar prod com CORS aberto (anti-pé-na-jaca)
if (CORS_WILDCARD && process.env.NODE_ENV === 'production' && !process.env.LOG_QUIET) {
  console.warn('[CORS] AVISO: CORS_ALLOWED_ORIGINS="*" em NODE_ENV=production — defina origens específicas.');
}
function corsOriginPermitida(origin) {
  if (!origin) return false;
  if (CORS_WILDCARD) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  // wildcard de subdomínio (ex: *.fesfsus.ba.gov.br)
  for (const padrao of CORS_ORIGINS) {
    if (padrao.startsWith('*.')) {
      const suf = padrao.slice(1); // '.fesfsus.ba.gov.br'
      if (origin.endsWith(suf)) return true;
    }
  }
  return false;
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (CORS_WILDCARD && !origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && corsOriginPermitida(origin)) {
    res.setHeader('Access-Control-Allow-Origin', CORS_WILDCARD ? '*' : origin);
    if (!CORS_WILDCARD) res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  // Headers que JS do navegador pode ler (úteis p/ debugging e paginação)
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, X-Total-Count, X-Page, X-Per-Page, X-Total-Pages, X-RateLimit-Remaining, X-RateLimit-Limit, X-Maintenance, X-Maintenance-Message, X-Truncated, X-Limit, Link');
  // Preflight cache: 10min — reduz tráfego de OPTIONS
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Security headers — defesa contra XSS, clickjacking, MIME-sniffing, etc.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0'); // navegadores modernos usam CSP
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP relaxado o suficiente para o app inline funcionar; em produção
  // recomenda-se gerar nonces para os <script> inline.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",      // inline ainda usado em forms; nonce ideal em prod
    "style-src 'self' 'unsafe-inline'",       // CSS inline no mockup
    "img-src 'self' data: blob:",             // avatares, blob URLs do preview
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  // HSTS apenas em prod (quando NODE_ENV=production)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Health (legado: mantido para back-compat — alias de /live)
app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Liveness probe (K8s) — só verifica que o processo está vivo
// FAST · sem DB · sem allocations · retorna 200 se o event loop não travou
app.get('/api/health/live', (_, res) => {
  res.json({ status: 'alive', time: new Date().toISOString() });
});

// Readiness probe (K8s) — verifica se está pronto para receber tráfego
// Checa: DB up, schema aplicado, migrações aplicadas
// Retorna 503 se algum check falhar — K8s tira de rotação automaticamente
app.get('/api/health/ready', async (_, res) => {
  const checks = {};
  let healthy = true;
  // Check 1: DB responsivo
  try {
    const { query } = await import('./db/index.js');
    const t0 = Date.now();
    await query('SELECT 1 AS ok');
    checks.db = { ok: true, latency_ms: Date.now() - t0 };
  } catch (e) {
    checks.db = { ok: false, erro: e.message };
    healthy = false;
  }
  // Check 2: tabelas críticas existem
  try {
    const { queryOne } = await import('./db/index.js');
    const r = await queryOne(`SELECT COUNT(*)::int AS n FROM unidades`);
    checks.schema = { ok: true, unidades_count: r.n };
  } catch (e) {
    checks.schema = { ok: false, erro: e.message };
    healthy = false;
  }
  // Check 3: migrações aplicadas
  try {
    const { statusMigrations } = await import('./db/index.js');
    const m = await statusMigrations();
    checks.migrations = { ok: true, aplicadas: m.length };
  } catch (e) {
    checks.migrations = { ok: false, erro: e.message };
    healthy = false;
  }
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ready' : 'not_ready',
    time: new Date().toISOString(),
    checks,
  });
});

// Version — para verificação de deploy / canary releases
import { execSync } from 'node:child_process';
const SERVER_STARTED_AT = new Date().toISOString();
let GIT_COMMIT = null;
try { GIT_COMMIT = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore','pipe','ignore'] }).toString().trim(); } catch {}
// V238 fix A4/A5: atualizar versão para refletir estado real do código (auditoria + fixes V237).
// V239: bump após fix raiz de TZ (process.env.TZ='UTC' antes do PGlite).
// V295: bump para acompanhar refinos visuais (V268-V294) e novas integrações (V291 client-errors, V292 OneDrive).
// V298: bump para forçar invalidação de cache no navegador via query string ?v=APP_VERSION.
// V299: fix vazamento de window._fesfFiles entre envios consecutivos.
const APP_VERSION = process.env.APP_VERSION || 'V299';
app.get('/api/version', (_, res) => res.json({
  app: 'fesf-portal-pagamentos',
  versao: APP_VERSION,
  build_commit: GIT_COMMIT || process.env.BUILD_COMMIT || null,
  build_time: process.env.BUILD_TIME || null,
  started_at: SERVER_STARTED_AT,
  uptime_segundos: Math.floor(process.uptime()),
  node_version: process.version,
  platform: process.platform,
  schema_version: APP_VERSION, // bater com a versão das migrações quando existirem
  capacidades: [
    'multi-unit-operator', 'pagamento-estruturado', 'hash-dedup',
    'rate-limit', 'security-headers', 'jwt-auth', 'db-pg-or-pglite',
    'backup-restore', 'openapi-3', 'request-id-logs',
    'client-error-capture', 'onedrive-storage', // V291, V292
  ],
}));

// OpenAPI spec (público — discoverability)
// V295: injeta APP_VERSION dinâmico na spec (era hardcoded 'V25' antes — anti-pattern do CHANGELOG ⛔ #6)
import { openApiSpec } from './openapi-spec.js';
const openApiSpecLive = { ...openApiSpec, info: { ...openApiSpec.info, version: APP_VERSION } };
app.get('/api/openapi.json', (_, res) => res.json(openApiSpecLive));

// System banner (público — JS de qualquer página, incluindo login, lê este)
app.get('/api/system-banner', async (_, res) => {
  try {
    const { queryOne } = await import('./db/index.js');
    const r = await queryOne(`SELECT valor FROM configuracoes WHERE chave='system_banner'`);
    if (!r) return res.json({ banner: null });
    let b = null;
    try { b = JSON.parse(r.valor); } catch {}
    if (!b || !b.texto) return res.json({ banner: null });
    // Filtra expirado
    if (b.expira_em && new Date(b.expira_em) < new Date()) return res.json({ banner: null });
    res.json({ banner: b });
  } catch (e) { res.json({ banner: null }); }
});

// Health detalhado: snapshot operacional do sistema
app.get('/api/health/detailed', async (_, res) => {
  try {
    const { query } = await import('./db/index.js');
    const t0 = Date.now();
    // Conta entidades principais
    const stats = {};
    for (const t of ['unidades','fornecedores','usuarios','modalidades','envios','versoes_envio','documentos','expectativas','lembretes','notificacoes','comentarios','auditoria','pagamentos','links_publicos','anotacoes_envio','anotacoes_documento','solicitacoes_reenvio','usuario_unidades','configuracoes','emails_simulados','fornecedor_unidades']) {
      try {
        const r = await query(`SELECT COUNT(*)::int AS n FROM ${t}`);
        stats[t] = r.rows[0].n;
      } catch { stats[t] = null; }
    }
    // Distribuicao por status
    const porStatus = (await query(`SELECT status, COUNT(*)::int AS n FROM envios GROUP BY status`)).rows;
    const porOrigem = (await query(`SELECT origem, COUNT(*)::int AS n FROM envios GROUP BY origem`)).rows;
    const pendentes = (await query(`SELECT COUNT(*)::int AS n FROM fornecedores WHERE pendente_aprovacao=TRUE`)).rows[0].n;
    const inadimplentes = (await query(`SELECT COUNT(*)::int AS n FROM fornecedores WHERE status_engajamento='inadimplente'`)).rows[0].n;
    const linksAtivos = (await query(`SELECT COUNT(*)::int AS n FROM links_publicos WHERE revogado=FALSE`)).rows[0].n;
    // Último evento de auditoria
    const ultEvento = (await query(`SELECT entidade, acao, criado_em FROM auditoria ORDER BY criado_em DESC LIMIT 1`)).rows[0] || null;
    // Verifica integridade dos 3 cenários (existem envios de cada origem?)
    const cenarios = {
      portal:       porOrigem.find(o => o.origem === 'portal')?.n || 0,
      link_publico: porOrigem.find(o => o.origem === 'link_publico')?.n || 0,
      manual:       porOrigem.find(o => o.origem === 'manual')?.n || 0,
    };
    const tempo_ms = Date.now() - t0;
    const { dbBackend, statusMigrations } = await import('./db/index.js');
    const migrations = await statusMigrations();
    const maintenance = await isMaintenance();
    res.json({
      ok: true,
      time: new Date().toISOString(),
      uptime_segundos: Math.floor(process.uptime()),
      versao: APP_VERSION + '+health',
      maintenance_mode: maintenance,
      db_backend: dbBackend(),
      migrations_aplicadas: migrations.length,
      ultima_migration: migrations.length > 0 ? migrations[migrations.length - 1].nome : null,
      tempo_consulta_ms: tempo_ms,
      contagens: stats,
      envios: { por_status: porStatus, por_origem: porOrigem },
      cenarios_em_uso: cenarios,
      fornecedores: { pendentes_aprovacao: pendentes, inadimplentes },
      links_publicos_ativos: linksAtivos,
      ultimo_evento_auditoria: ultEvento,
    });
  } catch (e) {
    console.error('[health/detailed]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// API
app.use('/api/auth', authRoutes);
app.use('/api/envios', envioRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/expectativas', expectativaRoutes);
app.use('/api/notificacoes', notificacaoRoutes);
app.use('/api/metricas', metricasRoutes);
app.use('/api/fornecedores', fornecedorRoutes); // /cadastrar, /pendentes, /:id/aprovar
app.use('/api', adminCrudRoutes); // CRUD unidades, usuarios, detalhes
app.use('/api', diretosRoutes); // /unidades, /modalidades, /fornecedores (GET), /auditoria
app.use('/api/search', searchRoutes); // busca global multi-categoria
app.use('/api', smtpRoutes); // /admin/smtp config + teste
app.use('/api', clientErrorRoutes); // V291: /client-errors (público) + /admin/client-errors
app.use('/api', storageRoutes); // V292: /admin/storage config OneDrive/SharePoint
app.use('/api/fornecedores', fornecedorDocumentosRoutes); // documentos fixos
app.use('/api', certidoesRoutes); // /admin/certidoes-alertas

// Serve estaticos: app funcional + mockup
// V297: Cache-Control com revalidação obrigatória em JS/CSS/HTML para evitar
// que o navegador sirva versão velha após deploy (problema recorrente —
// ver CHANGELOG ⛔ "cache do navegador" — caso típico: import de export
// que existe no servidor mas navegador tem versão velha do api.js).
function staticHeaders(res, path) {
  if (/\.html$/i.test(path)) {
    // HTML: nunca cachear. Garante que o cache-buster ?v=X no <script/link>
    // sempre chega atualizado ao navegador.
    res.setHeader('Cache-Control', 'no-store');
  } else if (/\.(js|css)$/i.test(path)) {
    // JS/CSS: cache só com revalidação ETag obrigatória
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  } else if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf)$/i.test(path)) {
    // Assets estáticos podem ser cacheados por 1 hora (raramente mudam)
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}

// V298: cache-busting automático — intercepta requests de HTML e injeta
// `?v=APP_VERSION` em <script src="/app/*.js"> e <link href="/app/*.css">.
// Ao mudar APP_VERSION em deploy, todas as URLs viram "novas" para o navegador
// e o cache velho é descartado sem precisar Cmd+Shift+R.
// Aplica apenas a paths locais (começam com / e terminam em .js/.css).
import { readFileSync } from 'fs';
function serveCacheBustedHtml(absPath, req, res) {
  try {
    let html = readFileSync(absPath, 'utf-8');
    const appendV = (url) => url.includes('?v=') ? url : `${url}?v=${APP_VERSION}`;

    // 1. <script src=...> e <link href=...>
    html = html.replace(
      /(<(?:script|link)[^>]+\b(?:src|href)=["'])(\/(?:app\/)?[\w\-\/\.]+\.(?:js|css))(["'])/gi,
      (_, pre, url, post) => `${pre}${appendV(url)}${post}`
    );

    // 2. ES module imports: `import ... from '/app/foo.js'` (estático)
    // Captura `import [...] from '<url>'` e `import('<url>')` (dinâmico)
    html = html.replace(
      /(\bimport\s+(?:[^'"]+\s+from\s+)?["'`])(\/(?:app\/)?[\w\-\/\.]+\.js)(["'`])/g,
      (_, pre, url, post) => `${pre}${appendV(url)}${post}`
    );
    html = html.replace(
      /(\bimport\s*\(\s*["'`])(\/(?:app\/)?[\w\-\/\.]+\.js)(["'`]\s*\))/g,
      (_, pre, url, post) => `${pre}${appendV(url)}${post}`
    );

    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (e) {
    res.status(404).end();
  }
}
function htmlInterceptor(baseDir) {
  return (req, res, next) => {
    if (!/\.html$/i.test(req.path)) return next();
    const absPath = join(baseDir, req.path.replace(/^\//, ''));
    serveCacheBustedHtml(absPath, req, res);
  };
}
app.use('/app', htmlInterceptor(join(__dirname, 'public', 'app')));
app.use('/app', express.static(join(__dirname, 'public', 'app'), { setHeaders: staticHeaders }));
// Raiz: mockup + formulários HCC (também podem importar /app/*.js)
app.use(htmlInterceptor(join(__dirname, '..')));
app.use(express.static(join(__dirname, '..'), { setHeaders: staticHeaders }));

// Rota raiz vai pro login do app real
app.get('/', (_, res) => res.redirect('/app/login.html'));

// Boot
(async () => {
  console.log('[server] inicializando banco...');
  // SKIP_SEED=1 → pula seed (útil em produção após o primeiro deploy)
  if (process.env.SKIP_SEED === '1') {
    console.log('[server] SKIP_SEED=1 → pulando seed');
    const { initSchema } = await import('./db/index.js');
    await initSchema();
  } else {
    await seed();
  }
  // Aplica migrações incrementais (após baseline)
  try {
    const { runMigrations } = await import('./db/index.js');
    const r = await runMigrations();
    if (r.aplicadas.length > 0) console.log(`[server] ${r.aplicadas.length} migração(ões) aplicadas`);
  } catch (e) { console.error('[migrations]', e.message); }

  // Escalonamento automatico periodico.
  // Default: a cada 5 minutos. Pode desabilitar com ESCALONAMENTO_INTERVALO_MS=0
  const intervalo = process.env.ESCALONAMENTO_INTERVALO_MS != null
    ? Number(process.env.ESCALONAMENTO_INTERVALO_MS)
    : 5 * 60 * 1000;
  if (intervalo > 0) {
    const rodar = async () => {
      try {
        const r = await executarEscalonamento();
        if (r.promovidasSemResposta || r.promovidasAtrasada) {
          console.log(`[escalonamento] sem_resposta:+${r.promovidasSemResposta} atrasada:+${r.promovidasAtrasada}`);
        }
      } catch (e) {
        console.error('[escalonamento]', e.message);
      }
    };
    setTimeout(rodar, 2000); // primeira execucao logo apos boot
    setInterval(rodar, intervalo);
    console.log(`[server] escalonamento automatico a cada ${intervalo}ms`);
  }

  // Housekeeping cron: roda diariamente na HOUSEKEEPING_HOUR (default 02:00).
  // Lock single-instance no DB garante que apenas uma replica executa.
  // Desabilita com HOUSEKEEPING_DISABLED=1 (util em testes).
  if (!process.env.HOUSEKEEPING_DISABLED) {
    const { iniciarSchedulerHousekeeping } = await import('./services/housekeeping-service.js');
    iniciarSchedulerHousekeeping();
    console.log(`[server] housekeeping cron ativo (hora-alvo: ${Number(process.env.HOUSEKEEPING_HOUR || 2)}h)`);
  }

  const httpServer = app.listen(PORT, () => {
    console.log(`[server] rodando em http://localhost:${PORT}`);
    console.log(`[server] app real: http://localhost:${PORT}/app/login.html`);
    console.log(`[server] mockup:   http://localhost:${PORT}/controle-pagamentos-mockup.html`);
  });

  // Graceful shutdown (SIGTERM do orquestrador, SIGINT do Ctrl+C)
  // Drena requests em vôo, fecha DB, sai com código 0
  let shuttingDown = false;
  const inFlight = new Set();
  app.use((req, res, next) => {
    if (shuttingDown) {
      res.setHeader('Connection', 'close');
      return res.status(503).json({ error: 'Servidor em shutdown · tente novamente' });
    }
    inFlight.add(res);
    res.on('finish', () => inFlight.delete(res));
    res.on('close', () => inFlight.delete(res));
    next();
  });

  async function shutdown(sinal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${sinal} recebido · iniciando shutdown gracioso (${inFlight.size} req em vôo)`);
    // 1. Para de aceitar novas conexões
    httpServer.close(async () => {
      console.log('[server] httpServer fechado · fechando DB');
      try {
        const { closeDb } = await import('./db/index.js');
        await closeDb();
      } catch (e) { console.error('[shutdown] erro ao fechar DB:', e.message); }
      console.log('[server] shutdown completo · saindo');
      process.exit(0);
    });
    // 2. Timeout de segurança — força exit em 10s se requests travarem
    setTimeout(() => {
      console.error(`[server] timeout · forçando exit (${inFlight.size} req ainda em vôo)`);
      process.exit(1);
    }, 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})().catch(e => {
  console.error('[server] falha no boot:', e);
  process.exit(1);
});
