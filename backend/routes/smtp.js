// =====================================================================
// V214: rotas de configuração SMTP. Tudo restrito a admin_fesf.
//   GET  /api/admin/smtp           — config atual (password mascarada)
//   PUT  /api/admin/smtp           — salva config
//   POST /api/admin/smtp/test      — envia e-mail de teste
//   GET  /api/admin/smtp/status    — bool simples para banners
// =====================================================================
import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import { getSmtpConfigPublic, getSmtpConfig, saveSmtpConfig, isSmtpEnabled } from '../services/smtp-config-service.js';
import { enviarTestEmail, resetTransporter } from '../services/email-service.js';

const router = Router();

router.get('/admin/smtp', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const config = await getSmtpConfigPublic();
    res.json({ config });
  } catch (e) { console.error('[smtp/get]', e); res.status(500).json({ error: 'Erro' }); }
});

router.put('/admin/smtp', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    await saveSmtpConfig(req.body || {}, { porUsuarioId: req.usuario.id });
    resetTransporter(); // força refresh com a nova config
    const config = await getSmtpConfigPublic();
    res.json({ ok: true, config });
  } catch (e) {
    if (e.code === 'INVALID') return res.status(400).json({ error: e.message });
    console.error('[smtp/put]', e); res.status(500).json({ error: 'Erro' });
  }
});

router.post('/admin/smtp/test', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { destinatario } = req.body || {};
    if (!destinatario) return res.status(400).json({ error: 'destinatario obrigatorio' });
    // Se vier config no body, usa essa (pré-salvar). Senão usa a config persistida.
    const usarBody = req.body && req.body.host;
    const cfg = usarBody ? req.body : await getSmtpConfig();
    // Se password não veio no body mas tem config salva, reusa
    if (usarBody && (!req.body.password || req.body.password.startsWith('**'))) {
      const atual = await getSmtpConfig();
      cfg.password = atual.password;
    }
    const r = await enviarTestEmail({ destinatario, ...cfg });
    res.json({ ok: true, messageId: r.messageId });
  } catch (e) {
    if (e.code === 'INVALID') return res.status(400).json({ error: e.message });
    console.error('[smtp/test]', e);
    res.status(502).json({ error: 'Falha no envio: ' + String(e.message || e).substring(0, 250) });
  }
});

router.get('/admin/smtp/status', requireAuth, async (req, res) => {
  res.json({ enabled: await isSmtpEnabled() });
});

export default router;
