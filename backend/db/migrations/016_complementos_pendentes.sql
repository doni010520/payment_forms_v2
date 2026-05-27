-- Migration 016 — Complementos pendentes (FGTS/INSS pós-pagamento)
-- ============================================================================
-- Permite que o fornecedor envie a NF sem GPS/FGTS comprovados (que só ficam
-- disponíveis após o dia 20 do mês seguinte à competência). O complemento é
-- enviado depois, sem precisar criar novo envio.

CREATE TABLE IF NOT EXISTS complementos_pendentes (
  id              SERIAL PRIMARY KEY,
  envio_id        INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  campo           TEXT NOT NULL,
  label           TEXT,
  motivo          TEXT,
  data_esperada   DATE NOT NULL,
  documento_id    INTEGER REFERENCES documentos(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'recebido', 'vencido')),
  criado_por_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recebido_em     TIMESTAMP,
  alerta_d3_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  alerta_d0_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (envio_id, campo)
);

CREATE INDEX IF NOT EXISTS idx_compl_envio ON complementos_pendentes(envio_id);
CREATE INDEX IF NOT EXISTS idx_compl_status_data ON complementos_pendentes(status, data_esperada)
  WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_compl_campo ON complementos_pendentes(campo);
