-- Migration 008 — V226 / F1.4: forçar troca de senha temporária no 1º login
-- Quando um admin cria um usuário ou reseta a senha de alguém, o sistema
-- gera uma senha aleatória que precisa ser trocada antes do uso normal.
-- A coluna `senha_temporaria_ativa` é setada TRUE nesses casos e volta
-- para FALSE quando o usuário troca a senha via /api/me/senha.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_temporaria_ativa BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_usuarios_senha_temp ON usuarios(senha_temporaria_ativa) WHERE senha_temporaria_ativa = TRUE;
