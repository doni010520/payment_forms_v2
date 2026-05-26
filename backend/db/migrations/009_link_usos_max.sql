-- Migration 009 — V227 / O6: limite explícito de usos em links públicos
-- Hoje: link é "single-use" OU "ilimitado" via uso_multiplo BOOLEAN.
-- A partir daqui: usos_max INTEGER define o teto (NULL = sem limite, requer
-- uso_multiplo=TRUE). uso_multiplo continua para retrocompatibilidade —
-- se usos_max=N e N>1, implícito que uso_multiplo=TRUE.

ALTER TABLE links_publicos ADD COLUMN IF NOT EXISTS usos_max INTEGER;
-- Default null = backward compat: respeita uso_multiplo legado.

CREATE INDEX IF NOT EXISTS idx_links_revogado_expira ON links_publicos(revogado, expira_em);
