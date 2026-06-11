// =====================================================================
// Routes admin: storage (Google Drive OAuth2 / OneDrive / Supabase)
// =====================================================================
import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import {
  obterConfigPublica, salvarConfig, testarConexao,
} from '../services/storage-service.js';

const router = Router();

// --- Config geral ---

router.get('/admin/storage', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const cfg = await obterConfigPublica();
    const { googleDriveDisponivel, obterStatusAutorizacao } = await import('../services/google-drive-service.js');
    const { supabaseStorageDisponivel } = await import('../services/supabase-storage.js');
    cfg.gdrive = {
      enabled: googleDriveDisponivel(),
      ...(googleDriveDisponivel() ? await obterStatusAutorizacao() : {}),
    };
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

// --- Google Drive OAuth2 ---

function getRedirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/api/admin/gdrive/callback`;
}

router.get('/admin/gdrive/authorize', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { googleDriveDisponivel, gerarUrlAutorizacao } = await import('../services/google-drive-service.js');
    if (!googleDriveDisponivel()) return res.status(400).json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_DRIVE_FOLDER_ID não configurados no Render' });
    const url = gerarUrlAutorizacao(getRedirectUri(req));
    res.redirect(url);
  } catch (e) {
    console.error('[gdrive/authorize]', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/gdrive/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) {
      return res.send(`<h2>Autorização negada</h2><p>${error}</p><p><a href="/app/admin.html">Voltar</a></p>`);
    }
    if (!code) {
      return res.status(400).send('<h2>Código ausente</h2><p><a href="/app/admin.html">Voltar</a></p>');
    }
    const { trocarCodePorTokens } = await import('../services/google-drive-service.js');
    const result = await trocarCodePorTokens(code, getRedirectUri(req));
    res.send(`
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"><title>Google Drive autorizado</title>
      <style>body{font-family:sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f7f7f4}
      .card{background:#fff;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08)}
      .ok{color:#2e7d32;font-size:48px}a{color:#5B5499}</style></head>
      <body><div class="card">
        <div class="ok">✓</div>
        <h2>Google Drive autorizado!</h2>
        <p>Conta: <strong>${result.email || '—'}</strong></p>
        <p>Os uploads agora vão para o Google Drive.</p>
        <p><a href="/app/admin.html">Voltar ao painel</a></p>
      </div></body></html>
    `);
  } catch (e) {
    console.error('[gdrive/callback]', e);
    res.status(500).send(`<h2>Erro na autorização</h2><p>${e.message}</p><p><a href="/app/admin.html">Voltar</a></p>`);
  }
});

// --- Teste de conexão ---

router.post('/admin/storage/test', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const backend = req.query.backend || 'auto';

    if (backend === 'gdrive' || backend === 'auto') {
      const { googleDriveDisponivel, estaAutorizado, testarConexaoGDrive } = await import('../services/google-drive-service.js');
      if (googleDriveDisponivel() && await estaAutorizado()) {
        try {
          const r = await testarConexaoGDrive();
          return res.json({ ...r, backend: 'gdrive' });
        } catch (e) {
          if (backend === 'gdrive') return res.status(502).json({ ok: false, error: e.message, backend: 'gdrive' });
        }
      } else if (backend === 'gdrive') {
        return res.status(400).json({ ok: false, error: 'Google Drive não autorizado' });
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

// --- Teste de upload ---

router.post('/admin/storage/test-upload', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { googleDriveDisponivel, estaAutorizado, subirArquivoGDrive } = await import('../services/google-drive-service.js');
    if (!googleDriveDisponivel()) return res.status(400).json({ error: 'GDrive não configurado' });
    if (!await estaAutorizado()) return res.status(400).json({ error: 'GDrive não autorizado. Acesse /api/admin/gdrive/authorize primeiro.' });

    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const uploadsDir = join(__dirname, '..', '.uploads');
    await mkdir(uploadsDir, { recursive: true });
    const tmpPath = join(uploadsDir, 'diag-test-' + Date.now() + '.txt');
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
