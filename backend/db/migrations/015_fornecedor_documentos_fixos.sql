-- Migration 015 — Documentos fixos do fornecedor
-- Tabela para armazenar documentos permanentes do fornecedor (cartão CNPJ,
-- proposta comercial, contrato) que não precisam ser reenviados a cada envio
-- mensal. A validação automática também é aplicada a esses documentos.

CREATE TABLE IF NOT EXISTS fornecedor_documentos_fixos (
  id              SERIAL PRIMARY KEY,
  fornecedor_id   INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
  -- Tipo do documento fixo
  tipo            TEXT NOT NULL CHECK (tipo IN ('cartao_cnpj', 'proposta_comercial', 'contrato', 'outros')),
  nome_original   TEXT NOT NULL,
  mime_type       TEXT,
  tamanho_bytes   BIGINT,
  -- Caminho local ou onedrive://item-id (mesmo padrão de documentos)
  caminho         TEXT NOT NULL,
  hash_sha256     TEXT,
  -- Resultado da validação automática (mesmo schema de documentos.validacao_json)
  validacao_json  JSONB,
  data_expiracao  DATE,
  status_validade TEXT CHECK (status_validade IN ('ok', 'alerta', 'vencido', 'pendente')),
  -- Quem fez o upload
  uploaded_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Soft-delete: desativado pelo fornecedor ou operador, não apagado
  ativo           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_fdf_fornecedor
  ON fornecedor_documentos_fixos(fornecedor_id)
  WHERE ativo = TRUE;

CREATE INDEX IF NOT EXISTS idx_fdf_expiracao
  ON fornecedor_documentos_fixos(data_expiracao)
  WHERE data_expiracao IS NOT NULL AND ativo = TRUE;
