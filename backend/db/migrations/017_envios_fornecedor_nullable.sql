-- Migration 017: torna envios.fornecedor_id nullable
-- Permite submissoes via link publico sem fornecedor vinculado ao link.
-- O campo fica NULL quando um link generico (sem fornecedor_id) e usado.
ALTER TABLE envios ALTER COLUMN fornecedor_id DROP NOT NULL;
