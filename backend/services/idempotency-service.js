// =====================================================================
// Idempotency middleware — defesa contra double-submit
//
// Uso: aplique em rotas POST onde duplicação é cara (criar envio, pagamento).
// Cliente envia header X-Idempotency-Key (UUID idealmente). Se mesma key já
// processada nas últimas 24h, retornamos a resposta cacheada — request NÃO
// é re-executado.
//
// Aceita keys ausentes (rota funciona normal sem o header), mas RECOMENDA-SE
// no frontend para chamadas POST críticas.
// =====================================================================
import { query, queryOne } from '../db/index.js';

const TTL_HORAS = 24;

export function idempotency(endpoint) {
  return async (req, res, next) => {
    const key = req.headers['x-idempotency-key'];
    if (!key) return next(); // sem key, comportamento normal

    // Valida formato (32+ chars, alfanumérico/hífen)
    if (typeof key !== 'string' || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9_\-]+$/.test(key)) {
      return res.status(400).json({ error: 'X-Idempotency-Key inválida (8-128 chars alfanuméricos)' });
    }

    // Já processado? retorna cache
    try {
      const existente = await queryOne(
        `SELECT status_code, response_json FROM _idempotency
         WHERE key=$1 AND endpoint=$2 AND criado_em > NOW() - INTERVAL '${TTL_HORAS} hours'`,
        [key, endpoint]
      );
      if (existente) {
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(existente.status_code).json(JSON.parse(existente.response_json));
      }
    } catch {}

    // Não processado: intercepta res.json para cachear
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const code = res.statusCode || 200;
      // Cache APENAS sucessos e idempotent failures (4xx que cliente quer retry)
      // 5xx não cacheamos — pode ser transient
      if (code < 500 && code !== 429) {
        const payload = JSON.stringify(body);
        // Fire-and-forget — não bloqueia resposta
        query(
          `INSERT INTO _idempotency (key, endpoint, status_code, response_json) VALUES ($1,$2,$3,$4)
           ON CONFLICT (key) DO NOTHING`,
          [key, endpoint, code, payload]
        ).catch(() => {});
      }
      return originalJson(body);
    };
    next();
  };
}

/**
 * Limpa entradas expiradas. Chamável periodicamente.
 */
export async function cleanupIdempotency() {
  try {
    const r = await query(`DELETE FROM _idempotency WHERE criado_em < NOW() - INTERVAL '${TTL_HORAS} hours'`);
    return r.rowCount || 0;
  } catch { return 0; }
}
