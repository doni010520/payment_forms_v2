-- Migration 012 — V231 / O2: histórico de autoria em anotações
-- Hoje `operador_id` é sobrescrito a cada UPDATE — perdemos quem criou.
-- Adiciona `criado_por_id` (preservado para sempre). `operador_id` passa
-- semanticamente a ser "última pessoa que tocou".

ALTER TABLE anotacoes_envio ADD COLUMN IF NOT EXISTS criado_por_id INTEGER REFERENCES usuarios(id);
ALTER TABLE anotacoes_documento ADD COLUMN IF NOT EXISTS criado_por_id INTEGER REFERENCES usuarios(id);

-- Dados legados: assume que operador_id == criador (não temos histórico anterior).
UPDATE anotacoes_envio SET criado_por_id = operador_id WHERE criado_por_id IS NULL;
UPDATE anotacoes_documento SET criado_por_id = operador_id WHERE criado_por_id IS NULL;
