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

// Diagnóstico: testa upload real para o Google Drive
router.post('/admin/storage/test-upload', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { googleDriveDisponivel, subirArquivoGDrive } = await import('../services/google-drive-service.js');
    if (!googleDriveDisponivel()) return res.status(400).json({ error: 'GDrive não configurado' });

    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const tmpPath = join(process.cwd(), 'backend', '.uploads', 'diag-test-' + Date.now() + '.txt');
    await writeFile(tmpPath, 'Teste diagnostico GDrive ' + new Date().toISOString());

    const result = await subirArquivoGDrive(tmpPath, 'diagnostico.txt', 'text/plain', {
      envioId: 0, protocolo: 'DIAG-TEST', fornecedor: 'Diagnostico', competencia: 'teste',
    });
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[admin/storage/test-upload]', e);
    res.status(500).json({ ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
});

export default router;
