import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import { query } from '../db/index.js';

const router = Router();

/**
 * GET /api/metricas — admin FESF Sede
 * Agregacoes da rede inteira.
 */
router.get('/', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { competencia } = req.query;
    const whereComp = competencia ? `WHERE e.competencia = '${competencia.replace(/'/g, '')}'` : '';

    const porUnidade = (await query(
      `SELECT u.sigla, u.nome,
              COUNT(e.id)::int AS total_envios,
              COALESCE(SUM(e.valor_centavos),0)::bigint AS total_centavos,
              SUM(CASE WHEN e.status='em_analise' THEN 1 ELSE 0 END)::int AS em_analise,
              SUM(CASE WHEN e.status='aguardando_ret' THEN 1 ELSE 0 END)::int AS aguardando_ret,
              SUM(CASE WHEN e.status='aprovado' THEN 1 ELSE 0 END)::int AS aprovados,
              SUM(CASE WHEN e.status='pago' THEN 1 ELSE 0 END)::int AS pagos,
              SUM(CASE WHEN e.status='rejeitado' THEN 1 ELSE 0 END)::int AS rejeitados
       FROM unidades u LEFT JOIN envios e ON e.unidade_id = u.id ${whereComp ? `AND e.competencia = '${competencia.replace(/'/g, '')}'` : ''}
       GROUP BY u.id, u.sigla, u.nome ORDER BY u.sigla`
    )).rows;

    const porOrigem = (await query(
      `SELECT origem, COUNT(*)::int AS n, COALESCE(SUM(valor_centavos),0)::bigint AS total_centavos
       FROM envios e ${whereComp} GROUP BY origem ORDER BY origem`
    )).rows;

    const porModalidade = (await query(
      `SELECT m.codigo, m.nome, COUNT(e.id)::int AS n, COALESCE(SUM(e.valor_centavos),0)::bigint AS total_centavos
       FROM modalidades m LEFT JOIN envios e ON e.modalidade_id = m.id ${whereComp ? `AND e.competencia = '${competencia.replace(/'/g, '')}'` : ''}
       GROUP BY m.id, m.codigo, m.nome ORDER BY m.nome`
    )).rows;

    const porStatus = (await query(
      `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(valor_centavos),0)::bigint AS total_centavos
       FROM envios e ${whereComp} GROUP BY status ORDER BY status`
    )).rows;

    const totais = (await query(
      `SELECT COUNT(*)::int AS total_envios, COALESCE(SUM(valor_centavos),0)::bigint AS total_centavos FROM envios e ${whereComp}`
    )).rows[0];

    const pendencias = (await query(
      `SELECT status, COUNT(*)::int AS n FROM expectativas
       ${competencia ? `WHERE competencia = '${competencia.replace(/'/g, '')}'` : ''} GROUP BY status`
    )).rows;

    // SLA: dias medios entre criacao e aprovacao (usa auditoria como fonte de verdade)
    // e entre aprovacao e pagamento.
    const sla = (await query(
      `WITH apr AS (
         SELECT a.entidade_id AS envio_id, MIN(a.criado_em) AS aprovado_em
         FROM auditoria a WHERE a.entidade='envio' AND a.acao='aprovado'
         GROUP BY a.entidade_id
       ), pag AS (
         SELECT a.entidade_id AS envio_id, MIN(a.criado_em) AS pago_em
         FROM auditoria a WHERE a.entidade='envio' AND a.acao='marcado_pago'
         GROUP BY a.entidade_id
       )
       SELECT
         COUNT(apr.envio_id)::int AS n_aprovados,
         COUNT(pag.envio_id)::int AS n_pagos,
         COALESCE(AVG(EXTRACT(EPOCH FROM (apr.aprovado_em - e.criado_em)) / 86400.0), 0)::float AS dias_ate_aprovado,
         COALESCE(AVG(EXTRACT(EPOCH FROM (pag.pago_em     - apr.aprovado_em)) / 86400.0), 0)::float AS dias_ate_pago
       FROM envios e
       LEFT JOIN apr ON apr.envio_id = e.id
       LEFT JOIN pag ON pag.envio_id = e.id
       ${whereComp}`
    )).rows[0];

    // Serie temporal: envios por semana (ultimas 8 semanas)
    const serie = (await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('week', criado_em), 'YYYY-MM-DD') AS semana,
         COUNT(*)::int AS n,
         COALESCE(SUM(valor_centavos),0)::bigint AS total_centavos
       FROM envios e
       WHERE criado_em >= CURRENT_DATE - INTERVAL '8 weeks' ${competencia ? `AND e.competencia = '${competencia.replace(/'/g, '')}'` : ''}
       GROUP BY DATE_TRUNC('week', criado_em)
       ORDER BY semana`
    )).rows;

    // KPI de inadimplencia
    const fornecedoresInadimplentes = (await query(
      `SELECT COUNT(*)::int AS n FROM fornecedores WHERE status_engajamento='inadimplente' AND ativo=TRUE`
    )).rows[0].n;

    // Distribuição por hora do dia (peak hours) — útil para planejar manutenções
    const horasRows = (await query(
      `SELECT EXTRACT(HOUR FROM criado_em)::int AS hora, COUNT(*)::int AS n
       FROM envios e
       WHERE criado_em >= CURRENT_DATE - INTERVAL '90 days' ${competencia ? `AND e.competencia = '${competencia.replace(/'/g, '')}'` : ''}
       GROUP BY hora ORDER BY hora`
    )).rows;
    // Preenche 0-23 (horas sem envios viram 0)
    const horasMap = Object.fromEntries(horasRows.map(r => [r.hora, r.n]));
    const por_hora_dia = Array.from({ length: 24 }, (_, h) => ({ hora: h, n: horasMap[h] || 0 }));

    res.json({ competencia, totais, por_unidade: porUnidade, por_origem: porOrigem, por_modalidade: porModalidade, por_status: porStatus, pendencias, sla, serie_semanal: serie, por_hora_dia, fornecedores_inadimplentes: fornecedoresInadimplentes });
  } catch (e) {
    console.error('[metricas]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

export default router;
