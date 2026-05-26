-- Migration 010 — V228 / O3.2: deadline + tentativas em solicitações de reenvio
-- Antes: solicitação aberta indefinidamente, sem visibilidade do "quantos vezes
-- já pedimos esse documento". Agora cada solicitação tem prazo de atendimento
-- e contador de tentativas (incrementa em re-solicitações do mesmo campo/doc).

ALTER TABLE solicitacoes_reenvio ADD COLUMN IF NOT EXISTS prazo_atendimento TIMESTAMP;
ALTER TABLE solicitacoes_reenvio ADD COLUMN IF NOT EXISTS tentativas INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_reenvio_status_prazo ON solicitacoes_reenvio(status, prazo_atendimento);
