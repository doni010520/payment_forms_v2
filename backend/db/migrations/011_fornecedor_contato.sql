-- Migration 011 — V229 / F1.3: persistir nome do contato responsável
-- Hoje o nome_contato é passado no body do cadastro mas SOMENTE usado
-- como nome do usuário criado na aprovação. Se admin demora a aprovar,
-- a informação some. Persistir desde o cadastro permite ao admin ver
-- "Quem é o contato?" antes de aprovar e cobrir o caso de aprovação
-- onde o usuário do portal não é criado (sem email).

ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS nome_contato TEXT;
