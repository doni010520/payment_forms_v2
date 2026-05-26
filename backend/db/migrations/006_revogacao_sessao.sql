-- Migration 006 — revogacao de sessoes (logout forcado)
-- Modelo simples: 1 linha por usuario com timestamp "revogue tudo emitido ANTES disso"
-- revogado_apos_epoch eh INTEGER (unix epoch em segundos) para evitar surpresas
-- de timezone entre PGlite/PG/JS Date. Compara direto com jwt.iat.
CREATE TABLE IF NOT EXISTS revogacao_sessao (
  usuario_id          INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  revogado_apos_epoch BIGINT NOT NULL,
  revogado_por        INTEGER REFERENCES usuarios(id),
  motivo              TEXT,
  criado_em           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
