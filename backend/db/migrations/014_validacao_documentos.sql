-- Migration 014 — Validação automática de documentos
-- Adiciona colunas à tabela documentos para guardar resultados de validação
-- determinística (fast-xml-parser, pdf-parse, Tesseract OCR) de certidões,
-- notas fiscais e outros arquivos enviados pelos fornecedores.

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS validacao_json  JSONB;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS data_expiracao  DATE;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS status_validade TEXT
  CHECK (status_validade IN ('ok', 'alerta', 'vencido', 'pendente'));

-- Documentos já existentes ficam como 'pendente' até serem processados
UPDATE documentos SET status_validade = 'pendente' WHERE status_validade IS NULL;

-- Índice parcial para consultas de monitoramento de validade (só linhas com data)
CREATE INDEX IF NOT EXISTS idx_documentos_expiracao
  ON documentos(data_expiracao)
  WHERE data_expiracao IS NOT NULL;

-- Índice parcial para filtro por status (painel de alertas)
CREATE INDEX IF NOT EXISTS idx_documentos_status_val
  ON documentos(status_validade)
  WHERE status_validade IS NOT NULL;

-- Feature toggle: configuração global do sistema de validação
INSERT INTO configuracoes (chave, valor) VALUES (
  'certidao_config',
  '{"validacao_ativa":true,"alertar_90_dias":true,"alertar_30_dias":true,"alertar_7_dias":true,"bloquear_vencidas":true}'
) ON CONFLICT (chave) DO NOTHING;
