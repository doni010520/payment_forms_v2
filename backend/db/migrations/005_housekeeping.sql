-- Migration 005 — registro de execuções do housekeeping (cron interno)
-- Unique constraint em (job, data_execucao_dia) garante single-instance:
-- duas réplicas tentando rodar o mesmo job no mesmo dia falham com
-- conflito; só uma vence o lock.
CREATE TABLE IF NOT EXISTS housekeeping_runs (
  id                  SERIAL PRIMARY KEY,
  job                 TEXT NOT NULL,                                    -- 'storage' | 'notificacoes' | 'auditoria'
  data_execucao_dia   DATE NOT NULL DEFAULT CURRENT_DATE,
  iniciado_em         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizado_em       TIMESTAMP,
  status              TEXT NOT NULL DEFAULT 'em_andamento',             -- 'em_andamento' | 'ok' | 'erro'
  resultado           TEXT,                                              -- JSON com métricas
  erro                TEXT,
  UNIQUE (job, data_execucao_dia)
);
CREATE INDEX IF NOT EXISTS idx_housekeeping_data ON housekeeping_runs(data_execucao_dia DESC);
