import { Router } from 'express';
import { requireAuth } from '../services/auth-service.js';
import { listarNotificacoes, contarNaoLidas, marcarLida, marcarTodasLidas } from '../services/notificacao-service.js';
import { paginar } from '../services/pagination.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const naoLidasApenas = req.query.nao_lidas === '1' || req.query.nao_lidas === 'true';
    const p = paginar(req, res);
    const { rows, total } = await listarNotificacoes(req.usuario.id, {
      naoLidasApenas, limit: p.limit, offset: p.offset, withTotal: true,
    });
    p.setHeaders(total);
    const naoLidas = await contarNaoLidas(req.usuario.id);
    res.json({
      notificacoes: rows,
      nao_lidas: naoLidas,
      paginacao: { page: p.page, per_page: p.perPage, total, total_pages: Math.max(1, Math.ceil(total / p.perPage)) },
    });
  } catch (e) {
    console.error('[notificacoes/list]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/:id/ler', requireAuth, async (req, res) => {
  try {
    await marcarLida(Number(req.params.id), req.usuario.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Erro' }); }
});

router.post('/ler-todas', requireAuth, async (req, res) => {
  try {
    await marcarTodasLidas(req.usuario.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Erro' }); }
});

export default router;
