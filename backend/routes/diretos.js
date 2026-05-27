// Rotas simples de leitura: unidades, modalidades, fornecedores, auditoria
import { Router } from 'express';
import { query, queryOne } from '../db/index.js';
import { requireAuth } from '../services/auth-service.js';
import { paginar } from '../services/pagination.js';

const router = Router();

/**
 * GET /api/auditoria/sistema
 * Trilha de auditoria sistema-wide (admin only). Filtros: entidade, acao, usuario_id, periodo.
 * Paginacao: ?page=&per_page= (preferido) ou ?limit=&offset= (legado).
 * Headers: X-Total-Count, X-Page, X-Per-Page, X-Total-Pages, Link.
 */
router.get('/auditoria/sistema', requireAuth, async (req, res) => {
  try {
    if (req.usuario.papel !== 'admin_fesf') return res.status(403).json({ error: 'Apenas admin FESF' });
    const { entidade, acao, usuario_id, dias, desde, ate, q } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push(`a.criado_em >= $${params.length + 1}::date`); params.push(desde); }
    if (ate)   { where.push(`a.criado_em < ($${params.length + 1}::date + INTERVAL '1 day')`); params.push(ate); }
    if (!desde && !ate) {
      where.push(`a.criado_em >= NOW() - INTERVAL '${Math.min(Number(dias) || 30, 365)} days'`);
    }
    if (entidade)    { where.push(`a.entidade = $${params.length + 1}`); params.push(entidade); }
    if (acao)        { where.push(`a.acao = $${params.length + 1}`); params.push(acao); }
    if (usuario_id)  { where.push(`a.usuario_id = $${params.length + 1}`); params.push(Number(usuario_id)); }
    if (q)           { where.push(`(LOWER(a.detalhe) LIKE $${params.length + 1} OR LOWER(u.nome) LIKE $${params.length + 1})`); params.push('%' + String(q).toLowerCase() + '%'); }
    const p = paginar(req, res);
    const queryParams = [...params, p.limit, p.offset];
    const sql = `
      SELECT a.id, a.entidade, a.entidade_id, a.acao, a.detalhe, a.criado_em,
             u.nome AS usuario_nome, u.papel AS usuario_papel, u.email AS usuario_email
      FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.criado_em DESC
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;
    const { rows } = await query(sql, queryParams);
    const sqlCount = `SELECT COUNT(*)::int AS n FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE ${where.join(' AND ')}`;
    const total = (await query(sqlCount, params)).rows[0].n;
    p.setHeaders(total);
    res.json({
      trilha: rows, total,
      paginacao: { page: p.page, per_page: p.perPage, total, total_pages: Math.max(1, Math.ceil(total / p.perPage)) },
    });
  } catch (e) {
    console.error('[auditoria/sistema]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/auditoria/sistema.csv?... — mesmos filtros do /sistema mas em CSV.
 * BOM UTF-8, separador ;, limite 10k linhas com X-Truncated quando excede.
 * Registra a propria exportacao em auditoria (compliance).
 */
router.get('/auditoria/sistema.csv', requireAuth, async (req, res) => {
  try {
    if (req.usuario.papel !== 'admin_fesf') return res.status(403).json({ error: 'Apenas admin FESF' });
    const { entidade, acao, usuario_id, dias, desde, ate, q } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push(`a.criado_em >= $${params.length + 1}::date`); params.push(desde); }
    if (ate)   { where.push(`a.criado_em < ($${params.length + 1}::date + INTERVAL '1 day')`); params.push(ate); }
    if (!desde && !ate) {
      where.push(`a.criado_em >= NOW() - INTERVAL '${Math.min(Number(dias) || 90, 365)} days'`);
    }
    if (entidade)    { where.push(`a.entidade = $${params.length + 1}`); params.push(entidade); }
    if (acao)        { where.push(`a.acao = $${params.length + 1}`); params.push(acao); }
    if (usuario_id)  { where.push(`a.usuario_id = $${params.length + 1}`); params.push(Number(usuario_id)); }
    if (q)           { where.push(`(LOWER(a.detalhe) LIKE $${params.length + 1} OR LOWER(u.nome) LIKE $${params.length + 1})`); params.push('%' + String(q).toLowerCase() + '%'); }

    const LIMITE = 10000;
    params.push(LIMITE + 1);
    const sql = `
      SELECT a.id, a.criado_em, a.entidade, a.entidade_id, a.acao, a.detalhe,
             u.nome AS usuario_nome, u.papel AS usuario_papel, u.email AS usuario_email
      FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.criado_em DESC
      LIMIT $${params.length}`;
    const { rows } = await query(sql, params);
    const truncado = rows.length > LIMITE;
    const dados = truncado ? rows.slice(0, LIMITE) : rows;

    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[;"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const linhas = ['id;criado_em;entidade;entidade_id;acao;detalhe;usuario_nome;usuario_papel;usuario_email'];
    for (const r of dados) {
      linhas.push([
        r.id,
        r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em,
        r.entidade, r.entidade_id, r.acao, r.detalhe || '',
        r.usuario_nome || '', r.usuario_papel || '', r.usuario_email || '',
      ].map(esc).join(';'));
    }
    const csv = '﻿' + linhas.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('X-Total-Count', String(dados.length));
    if (truncado) {
      res.setHeader('X-Truncated', 'true');
      res.setHeader('X-Limit', String(LIMITE));
    }
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
       VALUES ('sistema', 0, 'auditoria_exportada', $1, $2)`,
      [req.usuario.id, `${dados.length} linhas · filtros: ent=${entidade||'-'} acao=${acao||'-'} usr=${usuario_id||'-'} periodo=${desde||'-'}..${ate||'-'}`]
    );
    res.send(csv);
  } catch (e) {
    console.error('[auditoria/sistema.csv]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * GET /api/auditoria?entidade=envio&entidade_id=N
 * Trilha de auditoria de uma entidade especifica.
 */
router.get('/auditoria', requireAuth, async (req, res) => {
  try {
    const { entidade, entidade_id } = req.query;
    if (!entidade || !entidade_id) return res.status(400).json({ error: 'entidade e entidade_id obrigatorios' });
    // Escopo: fornecedor so ve dos proprios envios; operador so da unidade
    if (entidade === 'envio') {
      const envio = await queryOne('SELECT fornecedor_id, unidade_id FROM envios WHERE id=$1', [Number(entidade_id)]);
      if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
      if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
      if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    } else if (entidade === 'expectativa') {
      const e = await queryOne('SELECT unidade_id FROM expectativas WHERE id=$1', [Number(entidade_id)]);
      if (!e) return res.status(404).json({ error: 'expectativa nao encontrada' });
      if (req.usuario.papel === 'operador_unidade' && e.unidade_id !== req.usuario.unidade_id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
      if (req.usuario.papel === 'fornecedor') return res.status(403).json({ error: 'Acesso negado' });
    } else if (entidade === 'fornecedor') {
      if (req.usuario.papel === 'fornecedor' && Number(entidade_id) !== req.usuario.fornecedor_id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
      if (req.usuario.papel === 'operador_unidade') {
        // Operador pode ver auditoria de fornecedor que atende sua unidade
        const link = await queryOne(
          `SELECT 1 FROM fornecedor_unidades
           WHERE fornecedor_id = $1 AND unidade_id = $2`,
          [Number(entidade_id), req.usuario.unidade_id]
        );
        if (!link) return res.status(403).json({ error: 'Fornecedor n�o atende sua unidade' });
      }
    }
    const { rows } = await query(
      `SELECT a.id, a.acao, a.detalhe, a.criado_em, u.nome AS usuario_nome, u.papel AS usuario_papel
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.entidade = $1 AND a.entidade_id = $2
       ORDER BY a.criado_em DESC`,
      [entidade, Number(entidade_id)]
    );
    res.json({ trilha: rows });
  } catch (e) {
    console.error('[auditoria]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

router.get('/unidades', async (req, res) => {
  const incluirInativas = req.query.todas === '1';
  const sql = incluirInativas
    ? 'SELECT id, sigla, nome, cidade, estado, ativa FROM unidades ORDER BY ativa DESC, sigla'
    : 'SELECT id, sigla, nome, cidade, estado, ativa FROM unidades WHERE ativa = TRUE ORDER BY sigla';
  const { rows } = await query(sql);
  res.json({ unidades: rows });
});

router.get('/modalidades', async (req, res) => {
  const { rows } = await query('SELECT id, codigo, nome, categoria, formulario, documentos_esperados FROM modalidades WHERE ativa = TRUE ORDER BY categoria, nome');
  // Parse JSON helper
  const out = rows.map(m => ({ ...m, documentos_esperados: m.documentos_esperados ? (() => { try { return JSON.parse(m.documentos_esperados); } catch { return []; } })() : [] }));
  res.json({ modalidades: out });
});

router.get('/fornecedores', requireAuth, async (req, res) => {
  // operador_unidade: ve fornecedores que atendem sua unidade
  // admin_fesf: ve todos
  if (req.usuario.papel === 'fornecedor') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const { tipo } = req.query;
  if (req.usuario.papel === 'operador_unidade') {
    const params = [req.usuario.unidade_id];
    let extra = '';
    if (tipo) { params.push(tipo); extra = ` AND f.tipo = $2`; }
    const { rows } = await query(
      `SELECT DISTINCT f.id, f.razao_social, f.documento, f.tipo, f.email, f.telefone, f.status_engajamento, f.motivo_engajamento
       FROM fornecedores f
       JOIN fornecedor_unidades fu ON fu.fornecedor_id = f.id
       WHERE fu.unidade_id = $1 AND f.ativo = TRUE ${extra}
       ORDER BY f.razao_social`,
      params
    );
    return res.json({ fornecedores: rows });
  }
  // admin
  const params = [];
  let where = 'f.ativo = TRUE';
  if (tipo) { params.push(tipo); where += ` AND f.tipo = $1`; }
  const { rows } = await query(
    `SELECT f.id, f.razao_social, f.documento, f.tipo, f.email, f.telefone, f.status_engajamento, f.motivo_engajamento
     FROM fornecedores f WHERE ${where} ORDER BY f.razao_social`,
    params
  );
  res.json({ fornecedores: rows });
});

export default router;
