-- Migration 013 — V291: captura de erros do cliente
-- Tabela para registrar erros que acontecem no browser (JS runtime, unhandled rejections,
-- fetch failures, console.error). Permite ao admin diagnosticar problemas com precisão
-- mesmo quando o usuário não reporta — vê o erro exato + contexto.

CREATE TABLE IF NOT EXISTS client_errors (
  id SERIAL PRIMARY KEY,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Quem viu o erro (NULL se não logado)
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  papel TEXT,
  -- Contexto da página
  url TEXT NOT NULL,
  user_agent TEXT,
  -- Detalhes do erro
  tipo TEXT NOT NULL, -- 'runtime', 'unhandled-rejection', 'fetch-fail', 'console-error', 'http-error'
  mensagem TEXT NOT NULL,
  stack TEXT,
  -- Para fetch errors: método + URL alvo + status
  request_method TEXT,
  request_url TEXT,
  http_status INTEGER,
  -- Hash para dedup (mesmo erro repetindo)
  dedup_hash TEXT,
  ocorrencias INTEGER DEFAULT 1,
  ultima_ocorrencia TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Admin pode marcar como resolvido
  resolvido BOOLEAN DEFAULT FALSE,
  resolvido_em TIMESTAMPTZ,
  resolvido_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_client_errors_criado ON client_errors(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_client_errors_dedup ON client_errors(dedup_hash) WHERE resolvido = FALSE;
CREATE INDEX IF NOT EXISTS idx_client_errors_resolvido ON client_errors(resolvido, criado_em DESC);
