-- Migration 007 — V214: suporte a SMTP real
-- Adiciona colunas no log de e-mails para indicar se foi enviado de fato (via SMTP)
-- ou apenas registrado (simulator/fallback) + última mensagem de erro caso falhe.
-- A config SMTP em si vai na tabela `configuracoes` (chave='smtp', valor=JSON
-- com a senha encriptada via AES-256-GCM — ver services/crypto-helper.js).

ALTER TABLE emails_simulados ADD COLUMN IF NOT EXISTS enviado_real BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE emails_simulados ADD COLUMN IF NOT EXISTS erro_envio TEXT;
ALTER TABLE emails_simulados ADD COLUMN IF NOT EXISTS smtp_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_emails_enviado_real ON emails_simulados(enviado_real, criado_em DESC);
