// =====================================================================
// Routes admin: storage (OneDrive/SharePoint)
// V292
// =====================================================================
import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import {
  obterConfigPublica, salvarConfig, testarConexao,
} from '../services/storage-service.js';

const router = Router();

router.get('/admin/storage', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const cfg = await obterConfigPublica();
    res.json(cfg);
  } catch (e) {
    console.error('[admin/storage/get]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.put('/admin/storage', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const cfg = await salvarConfig(req.body || {}, req.usuario.id);
    res.json(cfg);
  } catch (e) {
    if (e.code === 'INVALID_CONFIG') return res.status(400).json({ error: e.message });
    console.error('[admin/storage/put]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/admin/storage/test', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await testarConexao();
    if (!r.ok) return res.status(502).json(r);
    res.json(r);
  } catch (e) {
    console.error('[admin/storage/test]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

export default router;
