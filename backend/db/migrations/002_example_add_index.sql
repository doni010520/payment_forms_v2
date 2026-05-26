-- =====================================================================
-- Migration 002 — exemplo: adiciona índice em envios.atualizado_em
-- Demonstra o padrão para migrações futuras. Idempotente via IF NOT EXISTS.
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_envios_atualizado_em ON envios(atualizado_em);
