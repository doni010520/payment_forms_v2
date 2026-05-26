-- =====================================================================
-- Migration 003 — tabela de chaves de idempotência para defesa contra double-submit
-- Standard pattern (Stripe, AWS, Square): cliente envia X-Idempotency-Key:
-- se já existir resposta com a mesma key, retornamos cache. TTL 24h.
-- =====================================================================
CREATE TABLE IF NOT EXISTS _idempotency (
  key            TEXT PRIMARY KEY,
  endpoint       TEXT NOT NULL,
  status_code    INTEGER NOT NULL,
  response_json  TEXT NOT NULL,
  criado_em      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_idempotency_criado ON _idempotency(criado_em);
