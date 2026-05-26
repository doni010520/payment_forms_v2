import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import { cadastrarFornecedor, cadastrarFornecedorExterno, aprovarFornecedor, rejeitarFornecedor, listarPendentes } from '../services/fornecedor-service.js';
import { rateLimit } from '../services/rate-limit-service.js';

const router = Router();

/**
 * POST /api/fornecedores/cadastrar (publico, sem auth)
 * Auto-cadastro de fornecedor.
 */
router.post('/cadastrar', rateLimit({ max: 5, windowMs: 60_000, key: 'cadastro' }), async (req, res) => {
  try {
    const r = await cadastrarFornecedor(req.body || {});
    res.status(201).json(r);
  } catch (e) {
    const map = {
      INVALID_TIPO: 400, INVALID_NAME: 400, INVALID_DOC: 400,
      INVALID_EMAIL: 400, DUPLICATED: 409,
    };
    if (map[e.code]) return res.status(map[e.code]).json({ error: e.message, code: e.code });
    console.error('[fornecedores/cadastrar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/fornecedores/externo (operador unidade ou admin)
 * Cadastra fornecedor externo (PJ ou PF) que NAO se cadastrou no portal.
 * Cria ativo, sem precisar de aprovacao.
 */
router.post('/externo', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { tipo, razao_social, documento, email, telefone, unidades_ids } = req.body || {};
    const f = await cadastrarFornecedorExterno({
      tipo, razao_social, documento, email, telefone,
      unidades_ids: unidades_ids || [],
      criadoPorUsuario: req.usuario,
    });
    res.status(201).json({ fornecedor: f });
  } catch (e) {
    const map = { INVALID_TIPO: 400, INVALID_NAME: 400, INVALID_DOC: 400, INVALID_EMAIL: 400, DUPLICATED: 409 };
    if (map[e.code]) return res.status(map[e.code]).json({ error: e.message, code: e.code });
    console.error('[fornecedores/externo]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/fornecedores/pendentes (admin)
 */
router.get('/pendentes', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const pendentes = await listarPendentes();
    res.json({ pendentes });
  } catch (e) {
    console.error('[fornecedores/pendentes]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/fornecedores/:id/aprovar (admin)
 */
router.post('/:id/aprovar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await aprovarFornecedor({
      fornecedorId: Number(req.params.id),
      usuarioId: req.usuario.id,
      nomeContato: req.body?.nome_contato,
    });
    res.json(r);
  } catch (e) {
    if (['NOT_FOUND','ALREADY_PROCESSED'].includes(e.code)) {
      return res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({ error: e.message });
    }
    console.error('[fornecedores/aprovar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/fornecedores/:id/rejeitar (admin)
 */
router.post('/:id/rejeitar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await rejeitarFornecedor({
      fornecedorId: Number(req.params.id),
      usuarioId: req.usuario.id,
      motivo: req.body?.motivo,
    });
    res.json(r);
  } catch (e) {
    if (e.code === 'MOTIVO_INVALID') return res.status(400).json({ error: e.message });
    if (['NOT_FOUND','ALREADY_PROCESSED'].includes(e.code)) {
      return res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({ error: e.message });
    }
    console.error('[fornecedores/rejeitar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * PATCH /api/fornecedores/:id/engajamento (operador/admin)
 * Marca status de engajamento: ativo | inadimplente | inativo
 * Body: { status, motivo? }
 */
router.patch('/:id/engajamento', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { status, motivo } = req.body || {};
    if (!['ativo','inadimplente','inativo'].includes(status)) return res.status(400).json({ error: 'status invalido' });
    if (status === 'inadimplente' && (!motivo || motivo.trim().length < 5)) return res.status(400).json({ error: 'motivo obrigatorio (>=5 chars) para inadimplencia' });
    const { query, queryOne } = await import('../db/index.js');
    const f = await queryOne('SELECT * FROM fornecedores WHERE id=$1', [Number(req.params.id)]);
    if (!f) return res.status(404).json({ error: 'fornecedor nao encontrado' });
    await query(
      `UPDATE fornecedores SET status_engajamento=$1, motivo_engajamento=$2 WHERE id=$3`,
      [status, motivo || null, f.id]
    );
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('fornecedor', $1, 'engajamento_atualizado', $2, $3)`,
      [f.id, req.usuario.id, `${status}${motivo ? ' · ' + motivo.substring(0,80) : ''}`]
    );
    res.json({ ok: true, status_engajamento: status });
  } catch (e) {
    console.error('[fornecedores/engajamento]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

export default router;
