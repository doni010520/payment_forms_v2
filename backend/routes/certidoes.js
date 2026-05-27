/**
 * certidoes.js
 * -------------
 * Endpoint para consultar certidões com alertas de validade.
 *
 * GET /api/admin/certidoes-alertas
 *   Retorna documentos com status_validade IN ('alerta','vencido').
 *   - admin_fesf: vê todos
 *   - operador_unidade: vê apenas sua(s) unidade(s)
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import { query } from '../db/index.js';

const router = Router();

/**
 * GET /api/admin/certidoes-alertas
 * Painel de certidões a vencer ou vencidas.
 */
router.get(
  '/admin/certidoes-alertas',
  requireAuth,
  requireRole('operador_unidade', 'admin_fesf'),
  async (req, res) => {
    try {
      const { papel, unidade_id, id: usuarioId } = req.usuario;

      // Filtra por unidade se for operador
      let unidadeFiltro = '';
      let params = [];

      if (papel === 'operador_unidade') {
        unidadeFiltro = `AND e.unidade_id IN (
          SELECT unidade_id FROM usuario_unidades WHERE usuario_id = $1
          UNION SELECT $2 WHERE $2 IS NOT NULL
        )`;
        params = [usuarioId, unidade_id];
      }

      const { rows } = await query(
        `SELECT
           d.id            AS doc_id,
           d.campo,
           d.nome_original,
           d.data_expiracao,
           d.status_validade,
           (d.data_expiracao - CURRENT_DATE) AS dias_restantes,
           e.id            AS envio_id,
           e.protocolo,
           e.competencia,
           f.id            AS fornecedor_id,
           f.razao_social,
           f.documento     AS cnpj,
           u.sigla         AS unidade_sigla,
           u.nome          AS unidade_nome
         FROM documentos d
         JOIN envios e    ON e.id = d.envio_id
         JOIN fornecedores f ON f.id = e.fornecedor_id
         JOIN unidades u  ON u.id = e.unidade_id
         WHERE d.status_validade IN ('alerta', 'vencido')
           AND d.data_expiracao IS NOT NULL
           ${unidadeFiltro}
         ORDER BY d.data_expiracao ASC
         LIMIT 500`,
        params
      );

      // Estatísticas resumidas
      const stats = {
        vencidas: rows.filter(r => r.status_validade === 'vencido').length,
        alertas:  rows.filter(r => r.status_validade === 'alerta').length,
        total:    rows.length,
      };

      res.json({ certidoes: rows, stats });
    } catch (e) {
      console.error('[certidoes/alertas]', e);
      res.status(500).json({ error: 'Erro ao consultar certidões' });
    }
  }
);

export default router;
