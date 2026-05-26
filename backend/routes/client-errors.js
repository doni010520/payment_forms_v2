// =====================================================================
// Routes: client errors (V291)
// POST /api/client-errors           — público (autenticado opcional), recebe erro
// GET  /api/admin/client-errors     — admin: lista erros
// PATCH /api/admin/client-errors/:id/resolver — marca como resolvido
// GET  /api/admin/client-errors/stats — estatísticas
// =====================================================================
import { Router } from 'express';
import { requireAuth, requireRole, verifyToken } from '../services/auth-service.js';
import {
  registrarErroCliente, listarErrosCliente, resolverErroCliente, estatisticasErros,
} from '../services/client-error-service.js';

const router = Router();

// Helper: tenta extrair usuário do token (sem falhar se ausente/inválido)
function decodeOptional(req) {
  try {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const payload = verifyToken(m[1]);
    return { id: payload.sub, papel: payload.papel };
  } catch { return null; }
}

// POST público — qualquer página do app pode reportar.
// Auth opcional: se o usuário estiver logado, anexamos id/papel; senão registra anônimo.
router.post('/client-errors', async (req, res) => {
  try {
    const usuario = decodeOptional(req);
    const r = await registrarErroCliente(req.body || {}, usuario);
    res.status(201).json(r);
  } catch (e) {
    if (e.code === 'INVALID_TIPO' || e.code === 'INVALID_PAYLOAD') {
      return res.status(400).json({ error: e.message });
    }
    console.error('[client-errors/post]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

// GET admin — lista para diagnóstico
router.get('/admin/client-errors', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { resolvido, tipo, limit, offset } = req.query;
    const args = {};
    if (resolvido === 'true') args.resolvido = true;
    else if (resolvido === 'false') args.resolvido = false;
    if (tipo) args.tipo = tipo;
    if (limit) args.limit = Number(limit);
    if (offset) args.offset = Number(offset);
    const r = await listarErrosCliente(args);
    res.json(r);
  } catch (e) {
    console.error('[admin/client-errors/get]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.patch('/admin/client-errors/:id/resolver', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await resolverErroCliente(Number(req.params.id), req.usuario.id);
    res.json(r);
  } catch (e) {
    console.error('[admin/client-errors/resolver]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.get('/admin/client-errors/stats', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await estatisticasErros();
    res.json(r);
  } catch (e) {
    console.error('[admin/client-errors/stats]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

export default router;
