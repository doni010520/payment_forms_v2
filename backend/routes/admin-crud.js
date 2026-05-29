// =====================================================================
// Routes admin: CRUD de unidades, usuarios + detalhes
// =====================================================================
import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import {
  criarUnidade, atualizarUnidade, alternarAtivaUnidade, detalheUnidade,
  atividadeRecenteUnidade, serieTemporal,
} from '../services/unidade-service.js';
import {
  listarUsuarios, criarUsuario, atualizarUsuario, resetarSenha, alterarMinhaSenha,
} from '../services/usuario-service.js';
import { detalheFornecedor } from '../services/fornecedor-service.js';
import { listarEmails, obterEmail } from '../services/email-service.js';

const router = Router();

// ========================= UNIDADES =========================
router.post('/unidades', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const u = await criarUnidade(req.body || {});
    res.status(201).json({ unidade: u });
  } catch (e) {
    const map = { INVALID_SIGLA: 400, INVALID_NAME: 400, INVALID_CIDADE: 400, DUPLICATED: 409 };
    if (map[e.code]) return res.status(map[e.code]).json({ error: e.message });
    console.error('[unidades/post]', e); res.status(500).json({ error: 'Erro' });
  }
});

router.put('/unidades/:id', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await atualizarUnidade(Number(req.params.id), req.body || {});
    res.json({ unidade: r });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    console.error('[unidades/put]', e); res.status(500).json({ error: 'Erro' });
  }
});

router.post('/unidades/:id/ativar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await alternarAtivaUnidade(Number(req.params.id), true);
    res.json(r);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    res.status(500).json({ error: 'Erro' });
  }
});
router.post('/unidades/:id/desativar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await alternarAtivaUnidade(Number(req.params.id), false);
    res.json(r);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    res.status(500).json({ error: 'Erro' });
  }
});

router.get('/unidades/:id/atividade', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (req.usuario.papel === 'operador_unidade' && req.usuario.unidade_id !== id) return res.status(403).json({ error: 'Acesso negado' });
    if (req.usuario.papel === 'fornecedor') return res.status(403).json({ error: 'Acesso negado' });
    const atividade = await atividadeRecenteUnidade(id, Number(req.query.limit) || 15);
    res.json({ atividade });
  } catch (e) { console.error('[unidades/atividade]', e); res.status(500).json({ error: 'Erro' }); }
});

router.get('/unidades/:id/serie', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (req.usuario.papel === 'operador_unidade' && req.usuario.unidade_id !== id) return res.status(403).json({ error: 'Acesso negado' });
    if (req.usuario.papel === 'fornecedor') return res.status(403).json({ error: 'Acesso negado' });
    const serie = await serieTemporal(id, Number(req.query.periodos || req.query.semanas) || 6, req.query.granularidade || "week");
    res.json({ serie });
  } catch (e) { console.error('[unidades/serie]', e); res.status(500).json({ error: 'Erro' }); }
});

router.get('/unidades/:id/detalhe', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Operador so ve detalhe da propria unidade; admin ve qualquer
    if (req.usuario.papel === 'operador_unidade' && req.usuario.unidade_id !== id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'fornecedor') return res.status(403).json({ error: 'Acesso negado' });
    const d = await detalheUnidade(id);
    res.json(d);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    console.error('[unidades/detalhe]', e); res.status(500).json({ error: 'Erro' });
  }
});

// ========================= FORNECEDOR DETALHE =========================
router.get('/fornecedores/:id/detalhe', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (req.usuario.papel === 'fornecedor' && req.usuario.fornecedor_id !== id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'operador_unidade') {
      // operador so pode ver fornecedores vinculados a sua unidade
      const { rows: [v] } = await import('../db/index.js').then(m => m.query(
        `SELECT 1 FROM fornecedor_unidades WHERE fornecedor_id=$1 AND unidade_id=$2`,
        [id, req.usuario.unidade_id]
      ).then(r => ({ rows: r.rows })));
      if (!v) return res.status(403).json({ error: 'Fornecedor nao atende sua unidade' });
    }
    const d = await detalheFornecedor(id);
    res.json(d);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    console.error('[fornecedores/detalhe]', e); res.status(500).json({ error: 'Erro' });
  }
});

// ========================= USUARIOS =========================
router.get('/usuarios', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { papel, unidade_id } = req.query;
    const usuarios = await listarUsuarios({ papel, unidade_id });
    res.json({ usuarios });
  } catch (e) { console.error('[usuarios/get]', e); res.status(500).json({ error: 'Erro' }); }
});

router.post('/usuarios', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await criarUsuario(req.body || {});
    res.status(201).json(r);
  } catch (e) {
    const map = { INVALID_PAPEL: 400, INVALID_NAME: 400, INVALID_EMAIL: 400, INVALID_UNIDADE: 400, DUPLICATED: 409 };
    if (map[e.code]) return res.status(map[e.code]).json({ error: e.message, code: e.code });
    console.error('[usuarios/post]', e); res.status(500).json({ error: 'Erro' });
  }
});

router.put('/usuarios/:id', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await atualizarUsuario(Number(req.params.id), req.body || {});
    res.json(r);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    res.status(500).json({ error: 'Erro' });
  }
});

// Gestao de unidades extras de um operador
router.get('/usuarios/:id/unidades', requireAuth, async (req, res) => {
  try {
    const { query } = await import('../db/index.js');
    const id = Number(req.params.id);
    if (req.usuario.papel !== 'admin_fesf' && req.usuario.id !== id) return res.status(403).json({ error: 'Acesso negado' });
    const u = await (await import('../db/index.js')).queryOne(`SELECT id, papel, unidade_id FROM usuarios WHERE id=$1`, [id]);
    if (!u) return res.status(404).json({ error: 'usuario nao encontrado' });
    const { rows: extras } = await query(`SELECT uu.unidade_id, un.sigla, un.nome FROM usuario_unidades uu JOIN unidades un ON un.id=uu.unidade_id WHERE uu.usuario_id=$1`, [id]);
    const primariaSig = u.unidade_id ? await (await import('../db/index.js')).queryOne(`SELECT id, sigla, nome FROM unidades WHERE id=$1`, [u.unidade_id]) : null;
    res.json({ primaria: primariaSig, extras });
  } catch (e) { console.error('[usuarios/unidades]', e); res.status(500).json({ error: 'Erro' }); }
});

router.post('/usuarios/:id/unidades', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { query } = await import('../db/index.js');
    const id = Number(req.params.id);
    const { unidade_id } = req.body || {};
    if (!unidade_id) return res.status(400).json({ error: 'unidade_id obrigatorio' });
    const u = await (await import('../db/index.js')).queryOne(`SELECT papel, unidade_id FROM usuarios WHERE id=$1`, [id]);
    if (!u) return res.status(404).json({ error: 'usuario nao encontrado' });
    if (u.papel !== 'operador_unidade') return res.status(400).json({ error: 'apenas operadores podem ter unidades extras' });
    if (Number(unidade_id) === u.unidade_id) return res.status(400).json({ error: 'esta eh a unidade primaria; nao precisa adicionar como extra' });
    try {
      await query(`INSERT INTO usuario_unidades (usuario_id, unidade_id) VALUES ($1, $2)`, [id, Number(unidade_id)]);
    } catch (e) {
      if (String(e.message || '').includes('duplicate') || String(e.message || '').includes('unique')) return res.status(409).json({ error: 'usuario ja tem esta unidade' });
      throw e;
    }
    await query(`INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('usuario', $1, 'unidade_extra_adicionada', $2, $3)`, [id, req.usuario.id, `unidade_id=${unidade_id}`]);
    res.status(201).json({ ok: true });
  } catch (e) { console.error('[usuarios/unidades/post]', e); res.status(500).json({ error: 'Erro' }); }
});

router.delete('/usuarios/:id/unidades/:unidadeId', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { query } = await import('../db/index.js');
    const id = Number(req.params.id);
    const unId = Number(req.params.unidadeId);
    const r = await query(`DELETE FROM usuario_unidades WHERE usuario_id=$1 AND unidade_id=$2`, [id, unId]);
    await query(`INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('usuario', $1, 'unidade_extra_removida', $2, $3)`, [id, req.usuario.id, `unidade_id=${unId}`]);
    res.json({ ok: true });
  } catch (e) { console.error('[usuarios/unidades/delete]', e); res.status(500).json({ error: 'Erro' }); }
});

router.post('/usuarios/:id/resetar-senha', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const r = await resetarSenha(Number(req.params.id), { porUsuarioId: req.usuario.id, novaSenha: req.body?.nova_senha });
    res.json(r);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/admin/fornecedores/:id/auditoria?dias=30
 * Timeline cronologica unificada do fornecedor:
 *   - eventos onde entidade='fornecedor' AND entidade_id=:id (cadastro, atualizacao)
 *   - eventos onde entidade='envio' AND envio.fornecedor_id=:id (aprovado, pago, etc)
 * Operador_unidade pode acessar se o fornecedor atende sua unidade.
 */
router.get('/admin/fornecedores/:id/auditoria', requireAuth, async (req, res) => {
  try {
    if (!['admin_fesf', 'operador_unidade'].includes(req.usuario.papel)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const { paginar } = await import('../services/pagination.js');
    const { query: q, queryOne: qo } = await import('../db/index.js');
    const fornecedorId = Number(req.params.id);
    const f = await qo(
      `SELECT id, razao_social, nome_fantasia, documento, tipo, status_engajamento, ativo, criado_em
       FROM fornecedores WHERE id=$1`, [fornecedorId]
    );
    if (!f) return res.status(404).json({ error: 'fornecedor nao encontrado' });
    // Escopo: operador so se atende esta unidade
    if (req.usuario.papel === 'operador_unidade') {
      const link = await qo(
        `SELECT 1 FROM fornecedor_unidades WHERE fornecedor_id=$1 AND unidade_id=$2`,
        [fornecedorId, req.usuario.unidade_id]
      );
      if (!link) return res.status(403).json({ error: 'fornecedor nao atende sua unidade' });
    }
    const dias = Math.max(1, Math.min(365, Number(req.query.dias) || 30));
    const desde = req.query.desde || null;
    const ate = req.query.ate || null;

    // WHERE para eventos relevantes (uniao de 2 condicoes via OR)
    // entidade='fornecedor' AND entidade_id=$1
    //   OR (entidade='envio' AND entidade_id IN (SELECT id FROM envios WHERE fornecedor_id=$1))
    const dateCond = desde && ate
      ? `a.criado_em >= $D::date AND a.criado_em < ($A::date + INTERVAL '1 day')`
      : desde ? `a.criado_em >= $D::date`
      : ate ? `a.criado_em < ($A::date + INTERVAL '1 day')`
      : `a.criado_em >= NOW() - INTERVAL '${dias} days'`;

    const baseWhere = `
      ( (a.entidade='fornecedor' AND a.entidade_id=$1)
        OR (a.entidade='envio' AND a.entidade_id IN (SELECT id FROM envios WHERE fornecedor_id=$1)) )
      AND ${dateCond.replace('$D', '$2').replace('$A', desde && ate ? '$3' : '$2')}
    `;
    const params = [fornecedorId];
    if (desde) params.push(desde);
    if (ate) params.push(ate);

    const { n: total } = await qo(`SELECT COUNT(*)::int AS n FROM auditoria a WHERE ${baseWhere}`, params);

    const { rows: agregados } = await q(
      `SELECT acao, COUNT(*)::int AS qtd FROM auditoria a
       WHERE ${baseWhere}
       GROUP BY acao ORDER BY qtd DESC, acao`,
      params
    );

    const p = paginar(req, res);
    const tlParams = [...params, p.limit, p.offset];
    const { rows: timeline } = await q(
      `SELECT a.id, a.entidade, a.entidade_id, a.acao, a.detalhe, a.criado_em,
              u.nome AS usuario_nome, u.papel AS usuario_papel
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE ${baseWhere}
       ORDER BY a.criado_em DESC
       LIMIT $${tlParams.length - 1} OFFSET $${tlParams.length}`,
      tlParams
    );
    p.setHeaders(total);

    res.json({
      fornecedor: f,
      periodo: { dias, desde, ate },
      total,
      agregado_por_acao: agregados,
      timeline,
      paginacao: { page: p.page, per_page: p.perPage, total, total_pages: Math.max(1, Math.ceil(total / p.perPage)) },
    });
  } catch (e) {
    console.error('[admin/fornecedores/auditoria]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * GET /api/admin/usuarios/:id/auditoria?dias=30
 * Timeline cronologica de TODAS as acoes que esse usuario executou.
 * Util para investigar incidentes ("o que o operador X fez nesse periodo?").
 * Retorna agregado por acao + lista paginada.
 */
router.get('/admin/usuarios/:id/auditoria', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { paginar } = await import('../services/pagination.js');
    const { query: q, queryOne: qo } = await import('../db/index.js');
    const usuarioId = Number(req.params.id);
    const u = await qo('SELECT id, nome, email, papel, ativo, criado_em, ultimo_login FROM usuarios WHERE id=$1', [usuarioId]);
    if (!u) return res.status(404).json({ error: 'usuario nao encontrado' });
    const dias = Math.max(1, Math.min(365, Number(req.query.dias) || 30));
    const desde = req.query.desde || null;
    const ate = req.query.ate || null;

    const where = ['a.usuario_id = $1'];
    const params = [usuarioId];
    if (desde) { where.push(`a.criado_em >= $${params.length + 1}::date`); params.push(desde); }
    if (ate)   { where.push(`a.criado_em < ($${params.length + 1}::date + INTERVAL '1 day')`); params.push(ate); }
    if (!desde && !ate) {
      where.push(`a.criado_em >= NOW() - INTERVAL '${dias} days'`);
    }

    // Total para paginacao
    const totalSql = `SELECT COUNT(*)::int AS n FROM auditoria a WHERE ${where.join(' AND ')}`;
    const { n: total } = await qo(totalSql, params);

    // Agregado por acao
    const aggSql = `SELECT acao, COUNT(*)::int AS qtd
                    FROM auditoria a
                    WHERE ${where.join(' AND ')}
                    GROUP BY acao ORDER BY qtd DESC, acao`;
    const { rows: agregados } = await q(aggSql, params);

    // Timeline paginada
    const p = paginar(req, res);
    const tlParams = [...params, p.limit, p.offset];
    const tlSql = `
      SELECT a.id, a.entidade, a.entidade_id, a.acao, a.detalhe, a.criado_em
      FROM auditoria a
      WHERE ${where.join(' AND ')}
      ORDER BY a.criado_em DESC
      LIMIT $${tlParams.length - 1} OFFSET $${tlParams.length}`;
    const { rows: timeline } = await q(tlSql, tlParams);
    p.setHeaders(total);

    res.json({
      usuario: u,
      periodo: { dias, desde, ate },
      total,
      agregado_por_acao: agregados,
      timeline,
      paginacao: { page: p.page, per_page: p.perPage, total, total_pages: Math.max(1, Math.ceil(total / p.perPage)) },
    });
  } catch (e) {
    console.error('[admin/usuarios/auditoria]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * POST /api/admin/usuarios/:id/sessoes/revogar
 * Admin forca logout de todas as sessoes ativas de um usuario.
 * Util quando: senha vazou, funcionario foi demitido, suspeita de conta comprometida.
 */
router.post('/admin/usuarios/:id/sessoes/revogar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { revogarSessoesDoUsuario } = await import('../services/auth-service.js');
    const { query: q, queryOne: qo } = await import('../db/index.js');
    const alvo = await qo('SELECT id, nome, email FROM usuarios WHERE id=$1', [Number(req.params.id)]);
    if (!alvo) return res.status(404).json({ error: 'usuario nao encontrado' });
    const motivo = String(req.body?.motivo || 'revogado por admin');
    await revogarSessoesDoUsuario(alvo.id, { revogadoPor: req.usuario.id, motivo });
    await q(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
       VALUES ('usuario', $1, 'sessoes_revogadas', $2, $3)`,
      [alvo.id, req.usuario.id, `motivo: ${motivo}`]
    );
    res.json({ ok: true, usuario: { id: alvo.id, nome: alvo.nome, email: alvo.email }, motivo });
  } catch (e) {
    console.error('[sessoes/revogar admin]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * POST /api/me/sessoes/revogar
 * Usuario invalida suas proprias sessoes ativas (ex: troquei de senha, esqueci logado em pc publico).
 * O token atual TAMBEM eh invalidado, entao o front precisa redirecionar pro login.
 */
router.post('/me/sessoes/revogar', requireAuth, async (req, res) => {
  try {
    const { revogarSessoesDoUsuario } = await import('../services/auth-service.js');
    await revogarSessoesDoUsuario(req.usuario.id, { revogadoPor: req.usuario.id, motivo: 'auto-revogado pelo usuario' });
    res.json({ ok: true, mensagem: 'todas as sessoes (inclusive esta) foram revogadas. faca login novamente.' });
  } catch (e) {
    console.error('[me/sessoes/revogar]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * PUT /api/me/fornecedor (fornecedor logado atualiza dados do PROPRIO fornecedor)
 */
router.put('/me/fornecedor', requireAuth, requireRole('fornecedor'), async (req, res) => {
  try {
    const { email, telefone, nome_fantasia } = req.body || {};
    const { query, queryOne } = await import('../db/index.js');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'email invalido' });
    // pega forn atual
    const f = await queryOne('SELECT * FROM fornecedores WHERE id=$1', [req.usuario.fornecedor_id]);
    if (!f) return res.status(404).json({ error: 'fornecedor nao encontrado' });
    // se email mudou e ja existe outro fornecedor com esse email, rejeita
    if (email && email !== f.email) {
      const dup = await queryOne('SELECT id FROM fornecedores WHERE email=$1 AND id<>$2', [email, f.id]);
      if (dup) return res.status(409).json({ error: 'e-mail ja em uso por outro fornecedor' });
    }
    await query(
      `UPDATE fornecedores SET email = COALESCE($1, email), telefone = COALESCE($2, telefone), nome_fantasia = COALESCE($3, nome_fantasia) WHERE id = $4`,
      [email || null, telefone || null, nome_fantasia || null, f.id]
    );
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('fornecedor', $1, 'perfil_atualizado', $2, $3)`,
      [f.id, req.usuario.id, JSON.stringify({ email_mudou: !!email && email !== f.email, telefone_mudou: !!telefone && telefone !== f.telefone })]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[me/fornecedor]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

// ========================= BACKUP / EXPORT (admin only) =========================
/**
 * GET /api/admin/backup
 * Exporta todo o estado do sistema como JSON estruturado.
 * Útil para: backup completo, DR, auditoria externa, migração entre ambientes.
 * NÃO inclui: arquivos físicos (em /uploads — fazer rsync separado), senha_hash (privacidade).
 */
router.get('/admin/backup', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { query } = await import('../db/index.js');
    const tabelas = [
      'unidades', 'fornecedores', 'fornecedor_unidades', 'usuarios', 'modalidades',
      'expectativas', 'links_publicos', 'envios', 'versoes_envio', 'documentos',
      'lembretes', 'auditoria', 'notificacoes', 'comentarios', 'emails_simulados',
      'anotacoes_envio', 'anotacoes_documento', 'pagamentos', 'solicitacoes_reenvio',
      'usuario_unidades', 'configuracoes',
    ];
    const dump = {};
    for (const t of tabelas) {
      try {
        const { rows } = await query(`SELECT * FROM ${t} ORDER BY ${t === 'fornecedor_unidades' || t === 'usuario_unidades' ? '1, 2' : 'id'}`);
        // Sanitiza: remove senha_hash de usuarios
        if (t === 'usuarios') {
          dump[t] = rows.map(({ senha_hash, ...r }) => r);
        } else {
          dump[t] = rows;
        }
      } catch (e) { dump[t] = { erro: e.message }; }
    }
    const totaisRegistros = Object.values(dump).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0);
    const backup = {
      meta: {
        gerado_em: new Date().toISOString(),
        gerado_por: req.usuario.id,
        versao_schema: process.env.APP_VERSION || 'V238',
        total_registros: totaisRegistros,
        tabelas_exportadas: tabelas.length,
        nota: 'senha_hash removida por privacidade · arquivos físicos em /uploads precisam de rsync separado',
      },
      dados: dump,
    };
    // Log na auditoria que houve export
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('sistema', 0, 'backup_exportado', $1, $2)`,
      [req.usuario.id, `${totaisRegistros} registros em ${tabelas.length} tabelas`]
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fesf-backup-${new Date().toISOString().substring(0,10)}.json"`);
    res.json(backup);
  } catch (e) {
    console.error('[admin/backup]', e);
    res.status(500).json({ error: 'Erro ao gerar backup' });
  }
});

/**
 * POST /api/admin/usuarios/bulk-reset-senha
 * Reseta senhas de múltiplos usuários de uma vez (incidente de segurança, rotação trimestral).
 * Body: { ids: [N], confirmacao: 'RESET_LOTE' }
 * Limite: 200 por chamada. Retorna mapa email→senha temporária.
 * NÃO permite resetar admin_fesf via bulk (proteção contra escalação acidental).
 */
router.post('/admin/usuarios/bulk-reset-senha', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { ids, confirmacao } = req.body || {};
    if (confirmacao !== 'RESET_LOTE') {
      return res.status(400).json({ error: 'Campo `confirmacao` deve ser exatamente "RESET_LOTE"' });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids[] obrigatório' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Máximo 200 por chamada' });
    }
    const { resetarSenha } = await import('../services/usuario-service.js');
    const { queryOne } = await import('../db/index.js');
    const resetados = [];
    const erros = [];
    for (const id of ids) {
      try {
        const u = await queryOne('SELECT id, email, papel FROM usuarios WHERE id=$1', [Number(id)]);
        if (!u) { erros.push({ id, erro: 'usuário não encontrado' }); continue; }
        if (u.papel === 'admin_fesf' && u.id !== req.usuario.id) {
          erros.push({ id, erro: 'bulk reset não permite admin_fesf · use endpoint individual' });
          continue;
        }
        const r = await resetarSenha(u.id, { porUsuarioId: req.usuario.id });
        resetados.push({ id: u.id, email: u.email, papel: u.papel, senha_temporaria: r.senha_temporaria });
      } catch (e) {
        erros.push({ id, erro: e.message });
      }
    }
    const { query } = await import('../db/index.js');
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('sistema', 0, 'bulk_reset_senha', $1, $2)`,
      [req.usuario.id, `${resetados.length} resetados · ${erros.length} erros`]
    );
    res.json({
      resetados,
      erros,
      total_solicitado: ids.length,
      nota: 'Envie as senhas temporárias por canal seguro (email criptografado ou SMS). NÃO logue.',
    });
  } catch (e) {
    console.error('[admin/bulk-reset]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * POST /api/admin/storage/limpar
 * Varre /uploads e remove arquivos físicos que não têm linha em documentos.caminho.
 * Body: { dry_run: true } para simular sem deletar (default: false executa).
 * Garante segurança: só toca em arquivos dentro de UPLOADS_DIR.
 */
router.post('/admin/storage/limpar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const dryRun = req.body?.dry_run === true;
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const uploadsDir = path.join(__dirname, '..', '.uploads');

    let arquivos = [];
    try { arquivos = await fs.readdir(uploadsDir); }
    catch { return res.json({ orfaos: [], bytes_liberados: 0, dry_run: dryRun, nota: '.uploads vazio ou inexistente' }); }

    const { query } = await import('../db/index.js');
    const { rows: docs } = await query('SELECT caminho FROM documentos');
    const referenciados = new Set(docs.map(d => path.basename(d.caminho)));

    const orfaos = [];
    let bytes = 0;
    for (const arquivo of arquivos) {
      if (referenciados.has(arquivo)) continue;
      const filePath = path.join(uploadsDir, arquivo);
      // Segurança: garante que está dentro de uploadsDir
      if (!filePath.startsWith(uploadsDir)) continue;
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          orfaos.push({ nome: arquivo, bytes: stat.size, idade_dias: Math.floor((Date.now() - stat.mtimeMs) / 86400000) });
          bytes += stat.size;
          if (!dryRun) await fs.unlink(filePath);
        }
      } catch {/* ignora arquivos com erro */}
    }
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('sistema', 0, 'storage_purgado', $1, $2)`,
      [req.usuario.id, `${dryRun ? '[DRY-RUN] ' : ''}${orfaos.length} arquivos órfãos · ${(bytes/1024).toFixed(1)} KB`]
    );
    res.json({
      orfaos_encontrados: orfaos.length,
      bytes_liberados: dryRun ? 0 : bytes,
      bytes_identificados: bytes,
      dry_run: dryRun,
      arquivos: orfaos.slice(0, 20), // amostra
    });
  } catch (e) {
    console.error('[admin/storage/limpar]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * POST /api/admin/notificacoes/limpar
 * Remove notificações LIDAS mais antigas que N dias (default 30).
 * NÃO toca em notificações não-lidas (usuário ainda precisa vê-las).
 * Mínimo 7 dias (proteção contra purga acidental).
 */
router.post('/admin/notificacoes/limpar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const dias = Math.max(7, Math.min(365, Number(req.body?.dias_lidas) || 30));
    const { query, queryOne } = await import('../db/index.js');
    const cnt = await queryOne(
      `SELECT COUNT(*)::int AS n FROM notificacoes WHERE lida=TRUE AND criada_em < NOW() - ($1 || ' days')::interval`,
      [dias]
    );
    await query(
      `DELETE FROM notificacoes WHERE lida=TRUE AND criada_em < NOW() - ($1 || ' days')::interval`,
      [dias]
    );
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('sistema', 0, 'notificacoes_purgadas', $1, $2)`,
      [req.usuario.id, `${cnt.n} lidas > ${dias} dias`]
    );
    res.json({ purgadas: cnt.n, dias_retencao: dias, preservadas: 'todas não-lidas + recentes' });
  } catch (e) {
    console.error('[admin/notif/limpar]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * POST /api/admin/auditoria/limpar
 * Remove eventos antigos da tabela auditoria (LGPD + performance).
 * Body: { dias: 365 } — default 365. Mínimo: 90 dias (garantia legal).
 *
 * AÇÕES CRÍTICAS NUNCA SÃO REMOVIDAS (pagamento, aprovação, rejeição, etc).
 * Apenas ações operacionais antigas (login, listagem, anotações já antigas).
 */
router.post('/admin/auditoria/limpar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const dias = Math.max(90, Math.min(3650, Number(req.body?.dias) || 365));
    // Acoes que NUNCA devem ser purgadas (audit trail legal)
    const acoesCriticas = [
      'aprovado', 'rejeitado', 'retificacao_solicitada', 'marcado_pago',
      'backup_exportado', 'backup_restaurado', 'cadastro_externo', 'auto_cadastro',
      'engajamento_atualizado', 'configuracao_atualizada', 'encaminhado_sede',
      'documento_duplicado_detectado',
    ];
    const { query, queryOne } = await import('../db/index.js');
    // Conta o que será purgado
    const placeholders = acoesCriticas.map((_, i) => `$${i + 2}`).join(',');
    const sqlCount = `
      SELECT COUNT(*)::int AS n FROM auditoria
      WHERE criado_em < NOW() - ($1 || ' days')::interval
      AND acao NOT IN (${placeholders})`;
    const params = [dias, ...acoesCriticas];
    const { n: aPurgar } = await queryOne(sqlCount, params);
    // Executa purge
    const sqlDel = `
      DELETE FROM auditoria
      WHERE criado_em < NOW() - ($1 || ' days')::interval
      AND acao NOT IN (${placeholders})`;
    await query(sqlDel, params);
    // Log da purga (na própria auditoria!)
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('sistema', 0, 'auditoria_purgada', $1, $2)`,
      [req.usuario.id, `purgou ${aPurgar} eventos > ${dias} dias (ações críticas preservadas)`]
    );
    res.json({ purgados: aPurgar, dias_retencao: dias, acoes_preservadas: acoesCriticas });
  } catch (e) {
    console.error('[admin/auditoria/limpar]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * GET /api/admin/housekeeping/status
 * Mostra ultima execucao de cada job do cron interno (storage, notificacoes, auditoria).
 */
router.get('/admin/housekeeping/status', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { statusHousekeeping } = await import('../services/housekeeping-service.js');
    const status = await statusHousekeeping();
    res.json({ jobs: status, hora_alvo: Number(process.env.HOUSEKEEPING_HOUR || 2) });
  } catch (e) {
    console.error('[housekeeping/status]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * POST /api/admin/housekeeping/executar
 * Forca execucao manual do housekeeping (respeitando o lock do dia).
 * Util para validar comportamento ou rodar fora de horario.
 */
router.post('/admin/housekeeping/executar', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { executarHousekeepingDoDia } = await import('../services/housekeeping-service.js');
    const r = await executarHousekeepingDoDia({ dryRunStorage: req.body?.dry_run_storage === true });
    res.json(r);
  } catch (e) {
    console.error('[housekeeping/executar]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * POST /api/admin/restore
 * Re-importa um backup JSON (gerado por /api/admin/backup).
 * Body: { confirmacao: 'SUBSTITUIR_TUDO', backup: { meta, dados } }
 *
 * EXTREMAMENTE DESTRUTIVO: trunca todas as tabelas e reinsere o backup.
 * Senha_hash: usuários no backup não têm senha; usuários existentes mantêm a senha
 * (lookup por email + manter senha_hash atual; se for usuário novo, gera senha randômica).
 */
router.post('/admin/restore', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { confirmacao, backup } = req.body || {};
    if (confirmacao !== 'SUBSTITUIR_TUDO') {
      return res.status(400).json({ error: 'Campo `confirmacao` deve ser exatamente "SUBSTITUIR_TUDO" para confirmar a operação destrutiva.' });
    }
    if (!backup || !backup.meta || !backup.dados) {
      return res.status(400).json({ error: 'backup invalido: precisa ter { meta, dados }' });
    }
    if (!backup.meta.versao_schema) {
      return res.status(400).json({ error: 'backup sem meta.versao_schema' });
    }
    const { query, truncateAll } = await import('../db/index.js');
    const bcrypt = (await import('bcryptjs')).default;
    const { nanoid } = await import('nanoid');

    // Salva senhas atuais por email (para preservar)
    const { rows: senhasAtuais } = await query('SELECT email, senha_hash FROM usuarios');
    const senhasMap = Object.fromEntries(senhasAtuais.map(u => [u.email, u.senha_hash]));

    // Trunca tudo
    await truncateAll();

    // Ordem topologica: parent->child
    const ordem = [
      'unidades', 'fornecedores', 'fornecedor_unidades', 'usuarios', 'modalidades',
      'expectativas', 'links_publicos', 'envios', 'versoes_envio', 'documentos',
      'lembretes', 'auditoria', 'notificacoes', 'comentarios', 'emails_simulados',
      'anotacoes_envio', 'anotacoes_documento', 'pagamentos', 'solicitacoes_reenvio',
      'usuario_unidades', 'configuracoes',
    ];
    const restaurados = {};
    const erros = [];
    for (const t of ordem) {
      const rows = backup.dados[t];
      if (!Array.isArray(rows)) { restaurados[t] = 0; continue; }
      let n = 0;
      for (const row of rows) {
        const obj = { ...row };
        // Para usuarios: reinjeta senha_hash do banco atual (por email) ou gera nova
        if (t === 'usuarios' && !obj.senha_hash) {
          obj.senha_hash = senhasMap[obj.email] || await bcrypt.hash(nanoid(12), 8);
        }
        const cols = Object.keys(obj);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`;
        try { await query(sql, cols.map(c => obj[c])); n++; }
        catch (e) { erros.push({ tabela: t, id: obj.id, erro: e.message.substring(0, 100) }); }
      }
      restaurados[t] = n;
      // Reseta sequence de id (caso tabela use SERIAL)
      try {
        const { rows: [mx] } = await query(`SELECT MAX(id)::int AS m FROM ${t}`);
        if (mx && mx.m) {
          await query(`SELECT setval(pg_get_serial_sequence('${t}','id'), $1)`, [mx.m]);
        }
      } catch {/* tabela sem id ou sequence: ok */}
    }
    const totalRestaurado = Object.values(restaurados).reduce((a, b) => a + b, 0);
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('sistema', 0, 'backup_restaurado', $1, $2)`,
      [req.usuario.id, `${totalRestaurado} reg · backup_meta=${backup.meta.gerado_em} versao=${backup.meta.versao_schema}`]
    );
    res.json({ ok: true, restaurados, total_restaurado: totalRestaurado, erros });
  } catch (e) {
    console.error('[admin/restore]', e);
    res.status(500).json({ error: 'Erro no restore: ' + e.message });
  }
});

// ========================= CONFIGURACOES (admin only) =========================
const CONFIG_PADRAO = {
  cadencia_lembretes: { antes: [5, 1], depois: [1, 3, 7] },
  sla_dias_aprovacao: 5,
  sla_dias_pagamento: 10,
  bloqueio_inadimplente: true,
  maintenance_mode: false,
  system_banner: null,  // { texto, severidade: 'info'|'warn'|'danger', expira_em: ISO_date }
};

router.get('/configuracoes', requireAuth, async (req, res) => {
  try {
    const { query } = await import('../db/index.js');
    const { rows } = await query('SELECT chave, valor, atualizado_em FROM configuracoes');
    const out = { ...CONFIG_PADRAO };
    for (const r of rows) {
      try { out[r.chave] = JSON.parse(r.valor); } catch { out[r.chave] = r.valor; }
    }
    res.json({ configuracoes: out, padrao: CONFIG_PADRAO });
  } catch (e) { console.error('[config/get]', e); res.status(500).json({ error: 'Erro' }); }
});

router.put('/configuracoes', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'body invalido' });
    const { query } = await import('../db/index.js');
    // upsert cada chave (limita a chaves conhecidas)
    const chavesValidas = Object.keys(CONFIG_PADRAO);
    let n = 0;
    for (const [chave, valor] of Object.entries(body)) {
      if (!chavesValidas.includes(chave)) continue;
      const json = JSON.stringify(valor);
      const existe = await (await import('../db/index.js')).queryOne('SELECT chave FROM configuracoes WHERE chave=$1', [chave]);
      if (existe) {
        await query(`UPDATE configuracoes SET valor=$1, atualizado_em=CURRENT_TIMESTAMP, atualizado_por=$2 WHERE chave=$3`, [json, req.usuario.id, chave]);
      } else {
        await query(`INSERT INTO configuracoes (chave, valor, atualizado_por) VALUES ($1, $2, $3)`, [chave, json, req.usuario.id]);
      }
      n++;
    }
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('configuracao', 0, 'configuracao_atualizada', $1, $2)`,
      [req.usuario.id, `chaves=${Object.keys(body).join(',')}`]
    );
    res.json({ ok: true, gravadas: n });
  } catch (e) { console.error('[config/put]', e); res.status(500).json({ error: 'Erro' }); }
});

/**
 * GET /api/me — perfil completo do usuario logado
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { queryOne } = await import('../db/index.js');
    const u = await queryOne(
      `SELECT u.id, u.papel, u.nome, u.email, u.criado_em, u.ultimo_login,
              u.primeiro_acesso, u.senha_temporaria_ativa,
              u.unidade_id, un.sigla AS unidade_sigla, un.nome AS unidade_nome,
              u.fornecedor_id, f.razao_social AS fornecedor_razao_social, f.tipo AS fornecedor_tipo,
              f.documento AS fornecedor_documento, f.telefone AS fornecedor_telefone, f.email AS fornecedor_email
       FROM usuarios u
       LEFT JOIN unidades un ON un.id = u.unidade_id
       LEFT JOIN fornecedores f ON f.id = u.fornecedor_id
       WHERE u.id=$1`,
      [req.usuario.id]
    );
    if (!u) return res.status(404).json({ error: 'nao encontrado' });
    res.json({ usuario: u });
  } catch (e) { console.error('[me/get]', e); res.status(500).json({ error: 'Erro' }); }
});

/**
 * GET /api/me/unidades
 * V214/F1.5: retorna SO as unidades que o usuario logado pode acessar.
 *   - fornecedor: unidades vinculadas em fornecedor_unidades
 *   - operador_unidade: primaria + extras (junction usuario_unidades)
 *   - admin_fesf: todas as ativas
 * Resolve fricção: antes portal-novo mostrava todas 8 unidades e fornecedor
 * descobria que nao atende so depois de preencher formulario inteiro.
 */
router.get('/me/unidades', requireAuth, async (req, res) => {
  try {
    const { query: q } = await import('../db/index.js');
    if (req.usuario.papel === 'fornecedor') {
      const { rows } = await q(
        `SELECT u.id, u.sigla, u.nome, u.cidade, u.estado
         FROM unidades u
         JOIN fornecedor_unidades fu ON fu.unidade_id = u.id
         WHERE fu.fornecedor_id = $1 AND u.ativa = TRUE
         ORDER BY u.sigla`,
        [req.usuario.fornecedor_id]
      );
      return res.json({ unidades: rows });
    }
    if (req.usuario.papel === 'admin_fesf') {
      const { rows } = await q(
        `SELECT id, sigla, nome, cidade, estado FROM unidades WHERE ativa = TRUE ORDER BY sigla`
      );
      return res.json({ unidades: rows });
    }
    // operador_unidade: usa helper que ja combina primaria + extras
    const { getUnidadesDoOperador } = await import('../services/auth-service.js');
    const ids = await getUnidadesDoOperador(req.usuario);
    if (!ids || ids.length === 0) return res.json({ unidades: [] });
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await q(
      `SELECT id, sigla, nome, cidade, estado FROM unidades
       WHERE id IN (${placeholders}) AND ativa = TRUE ORDER BY sigla`,
      ids
    );
    res.json({ unidades: rows });
  } catch (e) { console.error('[me/unidades]', e); res.status(500).json({ error: 'Erro: ' + e.message }); }
});

/**
 * PATCH /api/me — usuario logado atualiza o proprio nome
 */
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const { nome } = req.body || {};
    if (!nome || nome.trim().length < 3) return res.status(400).json({ error: 'nome invalido' });
    const { query } = await import('../db/index.js');
    await query(`UPDATE usuarios SET nome=$1 WHERE id=$2`, [nome.trim(), req.usuario.id]);
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('usuario', $1, 'nome_atualizado', $1, $2)`,
      [req.usuario.id, nome.trim().substring(0,80)]
    );
    res.json({ ok: true });
  } catch (e) { console.error('[me/patch]', e); res.status(500).json({ error: 'Erro' }); }
});

/**
 * DELETE /api/me/dados-pessoais — LGPD Art. 18 VI (direito ao esquecimento)
 * Fornecedor solicita anonimização da própria identidade.
 *
 * IMPORTANTE: NÃO é hard-delete. Por obrigação legal (RFB 5 anos, TCE, controle interno),
 * pagamentos efetuados e auditoria financeira NÃO podem ser apagados. Anonimizamos:
 *   - razao_social → "[ANONIMIZADO via LGPD]"
 *   - documento → "ANON-{id}" (preserva UNIQUE)
 *   - email/telefone → NULL
 *   - usuarios.email → "anon-{id}@anonimizado.lgpd"
 *   - usuarios.nome → "[ANONIMIZADO]"
 *   - desativa fornecedor + usuarios (login fica inviável)
 *
 * Body: { confirmacao: "ANONIMIZAR_DADOS", motivo: "..." }
 */
router.delete('/me/dados-pessoais', requireAuth, async (req, res) => {
  try {
    if (req.usuario.papel !== 'fornecedor') {
      return res.status(403).json({ error: 'Exclusivo para fornecedor titular dos dados' });
    }
    const { confirmacao, motivo } = req.body || {};
    if (confirmacao !== 'ANONIMIZAR_DADOS') {
      return res.status(400).json({ error: 'Campo `confirmacao` deve ser literal "ANONIMIZAR_DADOS"' });
    }
    if (!motivo || motivo.trim().length < 10) {
      return res.status(400).json({ error: 'motivo obrigatório (mín. 10 chars) para registro LGPD' });
    }
    const fornId = req.usuario.fornecedor_id;
    const { query } = await import('../db/index.js');

    // Anonimiza fornecedor
    await query(
      `UPDATE fornecedores SET
         razao_social = '[ANONIMIZADO via LGPD]',
         nome_fantasia = NULL,
         documento = 'ANON-' || id,
         email = NULL,
         telefone = NULL,
         ativo = FALSE,
         status_engajamento = 'inativo',
         motivo_engajamento = 'Anonimizado por solicitação LGPD'
       WHERE id = $1`,
      [fornId]
    );
    // Anonimiza usuários do fornecedor
    await query(
      `UPDATE usuarios SET
         nome = '[ANONIMIZADO]',
         email = 'anon-' || id || '@anonimizado.lgpd',
         ativo = FALSE
       WHERE fornecedor_id = $1`,
      [fornId]
    );
    // Limpa dados do submetente em envios antigos (mas preserva valores/auditoria)
    await query(
      `UPDATE envios SET
         submetido_por_nome = NULL,
         submetido_por_documento = NULL
       WHERE fornecedor_id = $1`,
      [fornId]
    );
    // Marca comentários do fornecedor como anonimizados (mas preserva texto p/ contexto operacional)
    // não removemos comentarios.usuario_id porque pagamentos derivados podem depender da trilha

    // Registra a solicitação LGPD na auditoria (preservada pela retention policy)
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('fornecedor', $1, 'lgpd_anonimizacao_solicitada', $2, $3)`,
      [fornId, req.usuario.id, `motivo: ${motivo.substring(0, 200)} · Art. 18 VI LGPD · NOTA: pagamentos preservados por obrigação fiscal (RFB 5 anos)`]
    );

    res.json({
      ok: true,
      base_legal: 'LGPD Lei 13.709/2018 Art. 18 VI',
      anonimizado: {
        fornecedor_id: fornId,
        razao_social: '[ANONIMIZADO via LGPD]',
        documento: `ANON-${fornId}`,
      },
      preservados_obrigacao_legal: [
        'envios (números de protocolo, valores, status)',
        'pagamentos (TED, banco, data — Receita Federal 5 anos)',
        'auditoria financeira (Lei 6.404, TCE-BA)',
      ],
      nota: 'Sua identidade foi anonimizada. Conta foi desativada — não será mais possível login. Registros financeiros são preservados por obrigação legal e não vinculam mais a você nominalmente.',
    });
  } catch (e) {
    console.error('[me/dados/delete]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * GET /api/me/dados-pessoais — LGPD Art. 18 (portabilidade)
 * Fornecedor logado exporta TODOS os próprios dados em JSON.
 * Inclui: dados cadastrais, envios, comentários próprios, notificações.
 * Operador/admin podem usar para responder requisição LGPD de fornecedor específico.
 */
router.get('/me/dados-pessoais', requireAuth, async (req, res) => {
  try {
    const { query, queryOne } = await import('../db/index.js');
    const t0 = Date.now();
    if (req.usuario.papel !== 'fornecedor') {
      return res.status(403).json({ error: 'Endpoint exclusivo para fornecedor. Admin: use /api/admin/backup' });
    }
    const fornId = req.usuario.fornecedor_id;
    if (!fornId) return res.status(400).json({ error: 'usuário sem fornecedor_id' });

    // 1. Dados cadastrais
    const fornecedor = await queryOne(
      `SELECT id, tipo, razao_social, nome_fantasia, documento, email, telefone, ativo, status_engajamento, motivo_engajamento, criado_em
       FROM fornecedores WHERE id=$1`, [fornId]
    );
    // 2. Usuários vinculados (sem senha_hash)
    const usuarios = (await query(
      `SELECT id, papel, nome, email, ativo, ultimo_login, criado_em
       FROM usuarios WHERE fornecedor_id=$1`, [fornId]
    )).rows;
    // 3. Unidades atendidas
    const unidades = (await query(
      `SELECT u.id, u.sigla, u.nome FROM fornecedor_unidades fu JOIN unidades u ON u.id=fu.unidade_id WHERE fu.fornecedor_id=$1`,
      [fornId]
    )).rows;
    // 4. Envios
    const envios = (await query(
      `SELECT e.id, e.protocolo, e.competencia, e.origem, e.status, e.valor_centavos, e.numero_nf, e.descricao, e.criado_em, e.atualizado_em,
              u.sigla AS unidade_sigla, m.nome AS modalidade_nome
       FROM envios e JOIN unidades u ON u.id=e.unidade_id JOIN modalidades m ON m.id=e.modalidade_id
       WHERE e.fornecedor_id=$1 ORDER BY e.criado_em DESC`, [fornId]
    )).rows;
    // 5. Versões (snapshot dos forms)
    const versoes = (await query(
      `SELECT v.envio_id, v.numero, v.dados_json, v.criada_em
       FROM versoes_envio v JOIN envios e ON e.id=v.envio_id
       WHERE e.fornecedor_id=$1 ORDER BY v.criada_em`, [fornId]
    )).rows;
    // 6. Documentos enviados (sem o blob, só metadados)
    const documentos = (await query(
      `SELECT d.id, d.envio_id, d.campo, d.nome_original, d.mime_type, d.tamanho_bytes, d.criado_em
       FROM documentos d JOIN envios e ON e.id=d.envio_id
       WHERE e.fornecedor_id=$1`, [fornId]
    )).rows;
    // 7. Comentários próprios (não os do operador)
    const comentarios = (await query(
      `SELECT c.id, c.envio_id, c.texto, c.criado_em, u.email AS autor_email
       FROM comentarios c JOIN usuarios u ON u.id=c.usuario_id
       WHERE u.fornecedor_id=$1 ORDER BY c.criado_em DESC`, [fornId]
    )).rows;
    // 8. Notificações
    const notificacoes = (await query(
      `SELECT n.id, n.tipo, n.mensagem, n.lida, n.criada_em
       FROM notificacoes n JOIN usuarios u ON u.id=n.usuario_id
       WHERE u.fornecedor_id=$1 ORDER BY n.criada_em DESC LIMIT 500`, [fornId]
    )).rows;
    // 9. Auditoria relacionada
    const { rows: auditoria } = await query(
      `SELECT a.entidade, a.entidade_id, a.acao, a.detalhe, a.criado_em
       FROM auditoria a
       WHERE (a.entidade='envio' AND a.entidade_id IN (SELECT id FROM envios WHERE fornecedor_id=$1))
          OR (a.entidade='fornecedor' AND a.entidade_id=$1)
       ORDER BY a.criado_em DESC LIMIT 1000`,
      [fornId]
    );

    // Log da exportação (própria auditoria)
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('fornecedor', $1, 'lgpd_dados_exportados', $2, $3)`,
      [fornId, req.usuario.id, `${envios.length} envios + ${documentos.length} docs + ${comentarios.length} comentários (Art. 18 LGPD)`]
    );

    const dump = {
      meta: {
        gerado_em: new Date().toISOString(),
        base_legal: 'LGPD Lei 13.709/2018 Art. 18 — direito de portabilidade',
        formato: 'JSON',
        tempo_geracao_ms: Date.now() - t0,
      },
      dados_pessoais: {
        fornecedor,
        usuarios,
        unidades_atendidas: unidades,
        envios,
        versoes,
        documentos_enviados: documentos,
        comentarios,
        notificacoes,
        auditoria_relacionada: auditoria,
      },
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="meus-dados-fesf-${new Date().toISOString().substring(0,10)}.json"`);
    res.json(dump);
  } catch (e) {
    console.error('[me/dados-pessoais]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * GET /api/me/notif-prefs — preferências de notificação do usuário logado
 */
router.get('/me/notif-prefs', requireAuth, async (req, res) => {
  try {
    const { queryOne } = await import('../db/index.js');
    const u = await queryOne(`SELECT notif_prefs FROM usuarios WHERE id=$1`, [req.usuario.id]);
    const DEFAULT_PREFS = { novo_envio: true, status_envio: true, comentarios: true, pagamento: true };
    let prefs = DEFAULT_PREFS;
    if (u && u.notif_prefs) {
      try { prefs = { ...DEFAULT_PREFS, ...JSON.parse(u.notif_prefs) }; } catch {}
    }
    res.json({ prefs, default: DEFAULT_PREFS });
  } catch (e) { console.error('[me/notif-prefs/get]', e); res.status(500).json({ error: 'Erro' }); }
});

/**
 * PUT /api/me/notif-prefs — salva preferências
 * Body: { prefs: { novo_envio: bool, ... } }
 */
router.put('/me/notif-prefs', requireAuth, async (req, res) => {
  try {
    const { prefs } = req.body || {};
    if (!prefs || typeof prefs !== 'object') return res.status(400).json({ error: 'prefs obrigatório (objeto)' });
    const CHAVES_VALIDAS = ['novo_envio', 'status_envio', 'comentarios', 'pagamento'];
    const limpo = {};
    for (const k of CHAVES_VALIDAS) {
      if (k in prefs) limpo[k] = prefs[k] === true;
    }
    const { query } = await import('../db/index.js');
    await query(`UPDATE usuarios SET notif_prefs=$1 WHERE id=$2`, [JSON.stringify(limpo), req.usuario.id]);
    res.json({ ok: true, prefs: limpo });
  } catch (e) { console.error('[me/notif-prefs/put]', e); res.status(500).json({ error: 'Erro' }); }
});

/**
 * POST /api/me/concluir-onboarding — marca primeiro_acesso=FALSE
 */
router.post('/me/concluir-onboarding', requireAuth, async (req, res) => {
  try {
    const { query } = await import('../db/index.js');
    await query(`UPDATE usuarios SET primeiro_acesso=FALSE WHERE id=$1`, [req.usuario.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[me/onboarding]', e); res.status(500).json({ error: 'Erro' }); }
});

router.post('/me/senha', requireAuth, async (req, res) => {
  try {
    const r = await alterarMinhaSenha({
      usuarioId: req.usuario.id,
      senhaAtual: req.body?.senha_atual,
      novaSenha: req.body?.nova_senha,
    });
    res.json(r);
  } catch (e) {
    const map = { INVALID_SENHA: 400, WRONG_PASSWORD: 401, NOT_FOUND: 404 };
    if (map[e.code]) return res.status(map[e.code]).json({ error: e.message });
    res.status(500).json({ error: 'Erro' });
  }
});

// ========================= EMAILS SIMULADOS =========================
router.get('/emails', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { destinatario, tipo, limit, offset } = req.query;
    const r = await listarEmails({ destinatario, tipo, limit, offset });
    res.json(r);
  } catch (e) { console.error('[emails/list]', e); res.status(500).json({ error: 'Erro' }); }
});

/**
 * GET /api/admin/emails.csv?destinatario=&tipo=&desde=&ate=
 * Export do log de e-mails para auditoria/compliance.
 * BOM UTF-8 para Excel ler acentos corretamente.
 * Limite duro: 10000 linhas; se atingido, header X-Truncated: true.
 */
router.get('/admin/emails.csv', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { query: q } = await import('../db/index.js');
    const { destinatario, tipo, desde, ate } = req.query;
    const where = [];
    const params = [];
    if (destinatario) { params.push('%' + String(destinatario).toLowerCase() + '%'); where.push(`LOWER(destinatario) LIKE $${params.length}`); }
    if (tipo)        { params.push(tipo); where.push(`tipo = $${params.length}`); }
    if (desde)       { params.push(desde); where.push(`criado_em >= $${params.length}::date`); }
    if (ate)         { params.push(ate); where.push(`criado_em < ($${params.length}::date + INTERVAL '1 day')`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const LIMITE = 10000;
    params.push(LIMITE + 1);
    const { rows } = await q(
      `SELECT id, criado_em, destinatario, tipo, assunto, entidade, entidade_id, visualizado
       FROM emails_simulados ${whereSql}
       ORDER BY criado_em DESC
       LIMIT $${params.length}`,
      params
    );
    const truncado = rows.length > LIMITE;
    const dados = truncado ? rows.slice(0, LIMITE) : rows;

    // CSV escape: aspas duplas duplicadas, envolve em aspas se contém ; , " ou \n
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[;"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const linhas = ['id;criado_em;destinatario;tipo;assunto;entidade;entidade_id;visualizado'];
    for (const r of dados) {
      linhas.push([
        r.id,
        r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em,
        r.destinatario, r.tipo, r.assunto,
        r.entidade || '', r.entidade_id || '',
        r.visualizado ? 'sim' : 'nao',
      ].map(esc).join(';'));
    }
    // BOM UTF-8 (﻿) para Excel interpretar acentos corretamente
    const csv = '﻿' + linhas.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="emails-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('X-Total-Count', String(dados.length));
    if (truncado) {
      res.setHeader('X-Truncated', 'true');
      res.setHeader('X-Limit', String(LIMITE));
    }
    // Auditoria do export (compliance: rastrear quem exportou)
    await q(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
       VALUES ('sistema', 0, 'emails_exportados', $1, $2)`,
      [req.usuario.id, `${dados.length} linhas · filtros: dest=${destinatario||'-'} tipo=${tipo||'-'} periodo=${desde||'-'}..${ate||'-'}`]
    );
    res.send(csv);
  } catch (e) {
    console.error('[admin/emails.csv]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

router.get('/emails/:id', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const e = await obterEmail(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'nao encontrado' });
    res.json({ email: e });
  } catch (err) { console.error('[emails/get]', err); res.status(500).json({ error: 'Erro' }); }
});

export default router;
