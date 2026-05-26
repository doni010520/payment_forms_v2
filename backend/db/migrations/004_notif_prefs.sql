-- =====================================================================
-- Migration 004 — preferências de notificação por usuário (server-side)
-- JSON com flags booleanos por tipo: { novo_envio, status_envio, comentarios, pagamento }
-- Default null = todos habilitados (back-compat).
-- =====================================================================
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS notif_prefs TEXT;
