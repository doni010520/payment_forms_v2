import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import {
  criarExpectativa, enviarLembrete, cancelarExpectativa,
  listarExpectativasUnidade, executarEscalonamento,
  previewCadencia, metricasExpectativas,
} from '../services/expectativa-service.js';
import { converterExpectativaEmManual } from '../services/envio-service.js';

const router = Router();

router.post('/', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { fornecedor_id, unidade_id, modalidade_id, competencia, prazo, origem_prevista, observacoes, cadencia, forcar_inadimplente } = req.body || {};
    if (!fornecedor_id || !unidade_id || !modalidade_id || !competencia || !prazo || !origem_prevista) {
      return res.status(400).json({ error: 'campos obrigatorios faltando' });
    }
    if (req.usuario.papel === 'operador_unidade' && req.usuario.unidade_id !== Number(unidade_id)) {
      return res.status(403).json({ error: 'Operador nao pertence a esta unidade' });
    }
    const exp = await criarExpectativa({
      usuarioId: req.usuario.id,
      fornecedorId: Number(fornecedor_id),
      unidadeId: Number(unidade_id),
      modalidadeId: Number(modalidade_id),
      competencia,
      prazo,
      origemPrevista: origem_prevista,
      observacoes,
      cadencia,
      forcarInadimplente: !!forcar_inadimplente,
    });
    res.status(201).json({ expectativa: exp });
  } catch (e) {
    if (e.code === 'INVALID_ORIGEM' || e.code === 'INVALID_CADENCIA') return res.status(400).json({ error: e.message });
    if (e.code === 'FORNECEDOR_INADIMPLENTE') return res.status(409).json({ error: e.message, code: 'FORNECEDOR_INADIMPLENTE' });
    console.error('[expectativas/create]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, competencia, unidade_id } = req.query;
    // Fornecedor: vê só as próprias
    if (req.usuario.papel === 'fornecedor') {
      const { query } = await import('../db/index.js');
      const where = ['ex.fornecedor_id = $1'];
      const params = [req.usuario.fornecedor_id];
      if (status)      { where.push(`ex.status = $${params.length + 1}`); params.push(status); }
      if (competencia) { where.push(`ex.competencia = $${params.length + 1}`); params.push(competencia); }
      const { rows } = await query(
        `SELECT ex.id, ex.competencia, ex.prazo, ex.origem_prevista, ex.status,
                un.sigla AS unidade_sigla, un.nome AS unidade_nome,
                m.codigo AS modalidade_codigo, m.nome AS modalidade_nome
         FROM expectativas ex
         JOIN unidades un ON un.id = ex.unidade_id
         JOIN modalidades m ON m.id = ex.modalidade_id
         WHERE ${where.join(' AND ')}
         ORDER BY ex.prazo ASC`,
        params
      );
      return res.json({ expectativas: rows });
    }
    // V225: admin sem unidade_id → vê todas (com sigla da unidade no resultado).
    // Operador: limitado à própria unidade (ignora override).
    let unidadeAlvoId = null;
    if (req.usuario.papel === 'operador_unidade') {
      unidadeAlvoId = req.usuario.unidade_id;
      if (!unidadeAlvoId) return res.status(400).json({ error: 'operador sem unidade_id' });
    } else if (req.usuario.papel === 'admin_fesf' && unidade_id) {
      unidadeAlvoId = Number(unidade_id);
    }
    const expectativas = await listarExpectativasUnidade(unidadeAlvoId, { status, competencia });
    res.json({ expectativas });
  } catch (e) {
    console.error('[expectativas/list]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/:id/lembrete', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { canal, conteudo } = req.body || {};
    const r = await enviarLembrete({
      expectativaId: Number(req.params.id),
      canal: canal || 'email',
      usuarioId: req.usuario.id,
      conteudo,
    });
    res.json(r);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    console.error('[expectativas/lembrete]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/expectativas/bulk/cancelar
 * Cancela varias expectativas de uma vez. Body: { ids: [], motivo }
 * IMPORTANTE: declarado ANTES de /:id/cancelar para nao colidir com :id="bulk"
 */
router.post('/bulk/cancelar', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { ids, motivo } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] obrigatorio' });
    if (ids.length > 200) return res.status(400).json({ error: 'maximo 200 por chamada' });
    if (!motivo || motivo.trim().length < 5) return res.status(400).json({ error: 'motivo obrigatorio (>=5 chars)' });
    const canceladas = [];
    const erros = [];
    for (const id of ids) {
      try {
        await cancelarExpectativa({ expectativaId: Number(id), usuarioId: req.usuario.id, motivo });
        canceladas.push(Number(id));
      } catch (e) {
        erros.push({ id, erro: e.message, code: e.code });
      }
    }
    res.json({ canceladas, erros, total_solicitado: ids.length });
  } catch (e) {
    console.error('[expectativas/bulk-cancelar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/:id/cancelar', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    await cancelarExpectativa({
      expectativaId: Number(req.params.id),
      usuarioId: req.usuario.id,
      motivo,
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'MOTIVO_INVALID') return res.status(400).json({ error: e.message });
    console.error('[expectativas/cancelar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/expectativas/:id/converter-manual
 * Atomicamente cria envio manual e marca expectativa como cumprida.
 */
router.post('/:id/converter-manual', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { motivo, valor_centavos, numero_nf, descricao } = req.body || {};
    const envio = await converterExpectativaEmManual({
      expectativaId: Number(req.params.id),
      usuarioId: req.usuario.id,
      motivo,
      valorCentavos: Number(valor_centavos) || 0,
      numeroNF: numero_nf,
      descricao,
    });
    res.status(201).json({ envio });
  } catch (e) {
    if (['MOTIVO_INVALID','FORBIDDEN','WRONG_UNIT','NOT_FOUND','ALREADY_DONE','CANCELED'].includes(e.code)) {
      return res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({ error: e.message });
    }
    console.error('[expectativas/converter]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/escalonar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await executarEscalonamento();
    res.json(r);
  } catch (e) {
    console.error('[expectativas/escalonar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

// V232/O4: preview da cadência de lembretes para uma expectativa hipotética
// Body: { prazo: 'YYYY-MM-DD', cadencia?: { antes:[N], depois:[N] } }
router.post('/preview-cadencia', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { prazo, cadencia } = req.body || {};
    const eventos = previewCadencia({ prazo, cadencia });
    res.json({ eventos });
  } catch (e) {
    if (e.code === 'INVALID') return res.status(400).json({ error: e.message });
    console.error('[expectativas/preview]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

// V232/O4: métricas agregadas. Operador sempre limitado à sua unidade.
router.get('/metricas', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    let unidadeId = null;
    if (req.usuario.papel === 'operador_unidade') {
      unidadeId = req.usuario.unidade_id;
    } else if (req.query.unidade_id) {
      unidadeId = Number(req.query.unidade_id);
    }
    const m = await metricasExpectativas({ unidadeId });
    res.json(m);
  } catch (e) {
    console.error('[expectativas/metricas]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

export default router;
