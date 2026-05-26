import { Router } from 'express';
import { login } from '../services/auth-service.js';
import { queryOne } from '../db/index.js';
import { notificarAdmins, notificar } from '../services/notificacao-service.js';
import { rateLimit } from '../services/rate-limit-service.js';

const router = Router();

/**
 * POST /api/auth/esqueci-senha
 * Publico. Recebe email, gera notificacao para admins resetarem.
 * Em producao seria envio de link por email com token JWT efemero.
 */
router.post('/esqueci-senha', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email obrigatorio' });
    const u = await queryOne('SELECT id, nome FROM usuarios WHERE email=$1 AND ativo=TRUE', [email]);
    // Sempre retorna 200 (evita revelar se email existe — boa pratica)
    if (u) {
      await notificarAdmins({
        tipo: 'sistema',
        mensagem: `Usuario "${u.nome}" (${email}) solicitou reset de senha`,
        link: '/app/admin-usuarios.html',
        entidade: 'usuario', entidadeId: u.id,
      });
      await notificar({
        usuarioId: u.id, tipo: 'sistema',
        mensagem: 'Sua solicitacao de reset de senha foi recebida. Aguarde contato da FESF Sede.',
      });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth/esqueci]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/login', rateLimit({ max: 10, windowMs: 60_000, key: 'login' }), async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    if (!email || !senha) return res.status(400).json({ error: 'email e senha sao obrigatorios' });
    const result = await login(email, senha);
    res.json(result);
  } catch (e) {
    if (e.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: 'Credenciais invalidas' });
    if (e.code === 'INACTIVE') return res.status(403).json({ error: 'Conta inativa' });
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

export default router;
