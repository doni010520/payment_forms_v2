import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import { criarLinkPublico, lookupToken, listarLinksUnidade, revogarLink } from '../services/link-service.js';

const router = Router();

/**
 * POST /api/links
 * Gera link publico (operador da unidade ou admin).
 */
router.post('/', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { fornecedor_id, unidade_id, modalidade_id, email_destinatario, expira_em, uso_multiplo, usos_max, expectativa_id } = req.body || {};
    if (!unidade_id || !modalidade_id) {
      return res.status(400).json({ error: 'unidade_id e modalidade_id obrigatorios' });
    }
    const link = await criarLinkPublico({
      usuarioId: req.usuario.id,
      fornecedorId: fornecedor_id ? Number(fornecedor_id) : null,
      unidadeId: Number(unidade_id),
      modalidadeId: Number(modalidade_id),
      emailDestinatario: email_destinatario,
      expiraEm: expira_em,
      usoMultiplo: !!uso_multiplo,
      usosMax: usos_max,
      expectativaId: expectativa_id ? Number(expectativa_id) : null,
    });
    res.status(201).json({ link });
  } catch (e) {
    if (e.code === 'INVALID') return res.status(400).json({ error: e.message });
    if (['FORBIDDEN','WRONG_UNIT'].includes(e.code)) return res.status(403).json({ error: e.message });
    console.error('[links/create]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/links/:token
 * Lookup publico (sem auth) — usado pelo form publico para descobrir o contexto.
 */
router.get('/:token', async (req, res) => {
  try {
    const info = await lookupToken(req.params.token);
    if (!info) return res.status(404).json({ error: 'Token nao encontrado' });
    res.json(info);
  } catch (e) {
    console.error('[links/lookup]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/unidades/:id/links
 * Lista links de uma unidade
 */
router.get('/unidade/:id', requireAuth, async (req, res) => {
  try {
    const unidadeId = Number(req.params.id);
    if (req.usuario.papel === 'operador_unidade' && req.usuario.unidade_id !== unidadeId) {
      return res.status(403).json({ error: 'Operador nao pertence a esta unidade' });
    }
    const links = await listarLinksUnidade(unidadeId);
    res.json({ links });
  } catch (e) {
    console.error('[links/listar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * DELETE /api/links/:id (revoga)
 */
router.delete('/:id', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    await revogarLink(Number(req.params.id), req.usuario.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[links/revogar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

export default router;
