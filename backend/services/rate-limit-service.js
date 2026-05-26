// =====================================================================
// Rate Limiter — token-bucket simples in-memory por IP
// Para produção sob alta carga: trocar por Redis (mesmo formato).
// =====================================================================

const buckets = new Map(); // ip+chave -> { count, resetAt }

/**
 * Cria middleware Express que limita N req por janela de tempo (ms).
 * Uso: app.post('/api/login', rateLimit({ max: 5, windowMs: 60000, key: 'login' }), handler)
 *
 * Opcoes:
 *   max         max requisicoes por bucket (default 30)
 *   windowMs    janela em ms (default 60000)
 *   key         prefixo do bucket (separa contadores entre endpoints)
 *   byUser      true → usa req.usuario.id quando autenticado, fallback IP.
 *               util para hospitais com NAT (50 fornecedores, 1 IP).
 *               IMPORTANTE: para byUser funcionar, precisa rodar APOS requireAuth.
 *
 * Headers expostos: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After (quando 429).
 *
 * Bypass: setar RATE_LIMIT_DISABLED=1 (útil em testes específicos).
 */
export function rateLimit({ max = 30, windowMs = 60_000, key = 'default', byUser = false } = {}) {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === '1') return next();
    let bucketKey;
    if (byUser && req.usuario && req.usuario.id) {
      bucketKey = `${key}:u:${req.usuario.id}`;
    } else {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      bucketKey = `${key}:ip:${ip}`;
    }
    const now = Date.now();
    let b = buckets.get(bucketKey);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, b);
    }
    b.count++;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Limite de ${max} requisições em ${windowMs/1000}s excedido. Tente em ${retryAfter}s.` });
    }
    next();
  };
}

/**
 * Limpa buckets expirados (chamável periodicamente).
 */
export function limparBucketsAntigos() {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Reseta TODOS os buckets (uso em testes).
 */
export function resetRateLimit() {
  buckets.clear();
}
