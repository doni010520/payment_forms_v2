// =====================================================================
// Routes admin: storage (Google Drive / OneDrive / Supabase)
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

    const { googleDriveDisponivel } = await import('../services/google-drive-service.js');
    const { supabaseStorageDisponivel } = await import('../services/supabase-storage.js');
    cfg.gdrive = { enabled: googleDriveDisponivel() };
    cfg.supabase = { enabled: supabaseStorageDisponivel() };

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
    const backend = req.query.backend || 'auto';

    if (backend === 'gdrive' || backend === 'auto') {
      const { googleDriveDisponivel, testarConexaoGDrive } = await import('../services/google-drive-service.js');
      if (googleDriveDisponivel()) {
        try {
          const r = await testarConexaoGDrive();
          return res.json({ ...r, backend: 'gdrive' });
        } catch (e) {
          if (backend === 'gdrive') return res.status(502).json({ ok: false, error: e.message, backend: 'gdrive' });
        }
      } else if (backend === 'gdrive') {
        return res.status(400).json({ ok: false, error: 'Google Drive não configurado (env vars ausentes)' });
      }
    }

    if (backend === 'onedrive' || backend === 'auto') {
      const r = await testarConexao();
      if (r.ok || backend === 'onedrive') return res.json({ ...r, backend: 'onedrive' });
    }

    res.json({ ok: true, backend: 'local', info: 'Nenhum backend remoto configurado' });
  } catch (e) {
    console.error('[admin/storage/test]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

export default router;
