import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import { criarEnvioPortal, criarEnvioLinkPublico, criarEnvioManual, listarEnviosUnidade, resumoOrigemUnidade, mudarStatusEnvio, criarNovaVersao } from '../services/envio-service.js';
import { query, queryOne } from '../db/index.js';
import multer from 'multer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { rateLimit } from '../services/rate-limit-service.js';
import { idempotency } from '../services/idempotency-service.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '..', '.uploads');
await mkdir(UPLOADS_DIR, { recursive: true });
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

const router = Router();

/**
 * GET /api/envios/protocolo/:protocolo (PUBLICO)
 * Consulta nao-autenticada por protocolo. Retorna apenas dados nao-sensiveis.
 * Util para fornecedores que enviaram via link publico e querem verificar status.
 */
router.get('/protocolo/:protocolo', rateLimit({ max: 30, windowMs: 60_000, key: 'consulta-protocolo' }), async (req, res) => {
  try {
    const envio = await queryOne(
      `SELECT e.protocolo, e.competencia, e.status, e.valor_centavos, e.numero_nf, e.criado_em, e.atualizado_em,
              u.sigla AS unidade_sigla, u.nome AS unidade_nome,
              m.nome AS modalidade_nome
       FROM envios e
       JOIN unidades u ON u.id = e.unidade_id
       JOIN modalidades m ON m.id = e.modalidade_id
       WHERE e.protocolo = $1`,
      [req.params.protocolo]
    );
    if (!envio) return res.status(404).json({ error: 'Protocolo nao encontrado' });
    // NAO retorna dados do fornecedor (privacidade)
    res.json({ envio });
  } catch (e) {
    console.error('[envios/protocolo]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/envios/protocolo/:protocolo/recibo (PUBLICO)
 * Retorna dados resumidos suficientes para gerar o recibo impressao,
 * sem expor dados sensiveis do fornecedor para anônimos.
 */
router.get('/protocolo/:protocolo/recibo', rateLimit({ max: 30, windowMs: 60_000, key: 'consulta-recibo' }), async (req, res) => {
  try {
    const envio = await queryOne(
      `SELECT e.id, e.protocolo, e.competencia, e.status, e.valor_centavos, e.numero_nf, e.origem,
              e.criado_em, e.atualizado_em, e.descricao,
              u.sigla AS unidade_sigla, u.nome AS unidade_nome,
              m.nome AS modalidade_nome,
              f.razao_social, f.documento
       FROM envios e
       JOIN unidades u ON u.id = e.unidade_id
       JOIN modalidades m ON m.id = e.modalidade_id
       LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
       WHERE e.protocolo = $1`,
      [req.params.protocolo]
    );
    if (!envio) return res.status(404).json({ error: 'Protocolo nao encontrado' });
    const { rows: documentos } = await query(
      `SELECT id, campo, nome_original, tamanho_bytes, criado_em FROM documentos WHERE envio_id=$1 ORDER BY criado_em`,
      [envio.id]
    );
    const { rows: versoes } = await query(
      `SELECT numero, criada_em FROM versoes_envio WHERE envio_id=$1 ORDER BY numero`,
      [envio.id]
    );
    const { rows: auditoria } = await query(
      `SELECT a.acao, a.criado_em, u.nome AS usuario_nome
       FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id
       WHERE a.entidade='envio' AND a.entidade_id=$1
       ORDER BY a.criado_em`,
      [envio.id]
    );
    const pagamento = await queryOne(
      `SELECT numero_ted, banco_pagador, data_efetiva, valor_pago_centavos, criado_em FROM pagamentos WHERE envio_id=$1 ORDER BY criado_em DESC LIMIT 1`,
      [envio.id]
    );
    res.json({ envio, documentos, versoes, auditoria, pagamento, form_data: null });
  } catch (e) {
    console.error('[envios/protocolo/recibo]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/portal
 * Cenario 1: fornecedor logado submete via portal
 */
router.post('/portal', requireAuth, requireRole('fornecedor'), rateLimit({ max: 60, windowMs: 60_000, key: 'envios.portal', byUser: true }), idempotency('envios.portal'), async (req, res) => {
  try {
    const { unidade_id, modalidade_id, competencia, valor_centavos, numero_nf, descricao, dados } = req.body || {};
    if (!unidade_id || !modalidade_id || !competencia) {
      return res.status(400).json({ error: 'unidade_id, modalidade_id, competencia obrigatorios' });
    }
    // Gate: bloqueia se o fornecedor tem certidões vencidas
    try {
      const { verificarBloqueioEnvio } = await import('../services/validacao-documentos-service.js');
      const bloqueio = await verificarBloqueioEnvio(req.usuario.fornecedor_id);
      if (bloqueio.bloqueado) {
        return res.status(422).json({
          error: 'Envio bloqueado: há certidões vencidas. Atualize seus documentos antes de enviar.',
          code: 'CERTIDOES_VENCIDAS',
          certidoes: bloqueio.certidoes,
        });
      }
    } catch {}

    const envio = await criarEnvioPortal({
      usuarioId: req.usuario.id,
      unidadeId: Number(unidade_id),
      modalidadeId: Number(modalidade_id),
      competencia,
      valorCentavos: Number(valor_centavos) || 0,
      numeroNF: numero_nf,
      descricao,
      dados,
    });
    // V300: registrar complementos pendentes (FGTS/INSS post-pagamento)
    if (Array.isArray(req.body.complementos_pendentes) && req.body.complementos_pendentes.length > 0) {
      try {
        const { registrarComplementos } = await import('../services/complementos-service.js');
        await registrarComplementos({
          envioId: envio.id, campos: req.body.complementos_pendentes,
          competencia, criadoPorId: req.usuario.id,
        });
      } catch (e) { console.error('[envios/portal/complementos]', e.message); }
    }
    // Email de recibo ao fornecedor (fire-and-forget — não bloqueia a resposta)
    ;(async () => {
      try {
        const { enviarEmail, templates } = await import('../services/email-service.js');
        const [usr, unid, forn] = await Promise.all([
          queryOne('SELECT email, nome FROM usuarios WHERE id=$1', [req.usuario.id]),
          queryOne('SELECT sigla, nome FROM unidades WHERE id=$1', [envio.unidade_id]),
          queryOne('SELECT razao_social FROM fornecedores WHERE id=$1', [req.usuario.fornecedor_id]),
        ]);
        if (!usr?.email) return;
        const valorFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
          .format((envio.valor_centavos || 0) / 100);
        const [ano, mes] = (envio.competencia || '').split('-');
        const competenciaFmt = mes && ano ? `${mes}/${ano}` : envio.competencia;
        const { assunto, corpo } = templates.envio_recebido({
          protocolo:   envio.protocolo,
          competencia: competenciaFmt,
          valor:       valorFmt,
          unidade:     unid ? `${unid.sigla} — ${unid.nome}` : String(envio.unidade_id),
          fornecedor:  forn?.razao_social || usr.nome,
          linkRecibo:  `https://fesf-payment-forms.onrender.com/app/recibo.html?protocolo=${encodeURIComponent(envio.protocolo)}`,
        });
        await enviarEmail({ destinatario: usr.email, assunto, corpo, tipo: 'envio_recebido', entidade: 'envio', entidadeId: envio.id });
      } catch (e) { console.error('[envios/portal/email-recibo]', e.message); }
    })();
    res.status(201).json({ envio });
  } catch (e) {
    if (e.code === 'FORBIDDEN')  return res.status(403).json({ error: e.message });
    if (e.code === 'NOT_LINKED') return res.status(403).json({ error: e.message });
    if (e.code === 'DUPLICATE_NF') return res.status(409).json({ error: e.message, code: e.code, envio_existente: e.envioExistente });
    console.error('[envios/portal]', e);
    res.status(500).json({ error: 'Erro ao criar envio' });
  }
});

/**
 * POST /api/envios/publico/:token
 * Cenario 2: anonimo submete via link publico
 */
router.post('/publico/:token', rateLimit({ max: 10, windowMs: 60_000, key: 'submit-publico' }), idempotency('envios.publico'), async (req, res) => {
  try {
    const { token } = req.params;
    const { competencia, valor_centavos, numero_nf, descricao, submetente_nome, submetente_documento, dados } = req.body || {};
    if (!competencia) return res.status(400).json({ error: 'competencia obrigatoria' });
    const envio = await criarEnvioLinkPublico({
      token,
      competencia,
      valorCentavos: Number(valor_centavos) || 0,
      numeroNF: numero_nf,
      descricao,
      dadosSubmetente: { nome: submetente_nome, documento: submetente_documento },
      dados,
    });
    if (Array.isArray(req.body.complementos_pendentes) && req.body.complementos_pendentes.length > 0) {
      try {
        const { registrarComplementos } = await import('../services/complementos-service.js');
        await registrarComplementos({
          envioId: envio.id, campos: req.body.complementos_pendentes,
          competencia, criadoPorId: null,
        });
      } catch (e) { console.error('[envios/publico/complementos]', e.message); }
    }
    res.status(201).json({ envio });
  } catch (e) {
    if (['INVALID_TOKEN','REVOKED','EXPIRED','ALREADY_USED','USOS_ESGOTADOS'].includes(e.code)) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    if (e.code === 'DUPLICATE_NF') return res.status(409).json({ error: e.message, code: e.code, envio_existente: e.envioExistente });
    console.error('[envios/publico]', e);
    res.status(500).json({ error: 'Erro ao criar envio publico' });
  }
});

/**
 * POST /api/envios/manual
 * Cenario 3: operador lanca em nome do fornecedor
 */
router.post('/manual', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { fornecedor_id, unidade_id, modalidade_id, competencia, valor_centavos, numero_nf, descricao, motivo, expectativa_id, permitir_duplicado } = req.body || {};
    if (!fornecedor_id || !unidade_id || !modalidade_id || !competencia || !motivo) {
      return res.status(400).json({ error: 'fornecedor_id, unidade_id, modalidade_id, competencia, motivo obrigatorios' });
    }
    const envio = await criarEnvioManual({
      usuarioId: req.usuario.id,
      fornecedorId: Number(fornecedor_id),
      unidadeId: Number(unidade_id),
      modalidadeId: Number(modalidade_id),
      competencia,
      valorCentavos: Number(valor_centavos) || 0,
      numeroNF: numero_nf,
      descricao,
      motivo,
      expectativaId: expectativa_id ? Number(expectativa_id) : null,
      permitirDuplicado: permitir_duplicado === true,
    });
    // V300: registrar complementos pendentes
    if (Array.isArray(req.body.complementos_pendentes) && req.body.complementos_pendentes.length > 0) {
      try {
        const { registrarComplementos } = await import('../services/complementos-service.js');
        await registrarComplementos({
          envioId: envio.id, campos: req.body.complementos_pendentes,
          competencia, criadoPorId: req.usuario.id,
        });
      } catch (e) { console.error('[envios/manual/complementos]', e.message); }
    }
    res.status(201).json({ envio });
  } catch (e) {
    if (e.code === 'MOTIVO_INVALID') return res.status(400).json({ error: e.message });
    if (e.code === 'FORBIDDEN')      return res.status(403).json({ error: e.message });
    if (e.code === 'WRONG_UNIT')     return res.status(403).json({ error: e.message });
    if (e.code === 'NO_FORN')        return res.status(404).json({ error: e.message });
    if (e.code === 'DUPLICATE_NF')   return res.status(409).json({ error: e.message, code: e.code, envio_existente: e.envioExistente });
    console.error('[envios/manual]', e);
    res.status(500).json({ error: 'Erro ao criar envio manual' });
  }
});

/**
 * GET /api/envios
 * Lista envios. Operador ve da propria unidade; admin ve tudo (filtravel).
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { origem, status, competencia, unidade_id, de, ate } = req.query;
    let unidadeAlvoId = req.usuario.unidade_id;
    if (req.usuario.papel === 'admin_fesf' && unidade_id) unidadeAlvoId = Number(unidade_id);
    if (req.usuario.papel === 'fornecedor') {
      // fornecedor logado ve so os proprios envios
      const { rows } = await query(
        `SELECT e.*, m.nome AS modalidade_nome, u.sigla AS unidade_sigla, u.nome AS unidade_nome
         FROM envios e
         JOIN modalidades m ON m.id = e.modalidade_id
         JOIN unidades u ON u.id = e.unidade_id
         WHERE e.fornecedor_id = $1
         ORDER BY e.criado_em DESC`,
        [req.usuario.fornecedor_id]
      );
      return res.json({ envios: rows });
    }
    if (!unidadeAlvoId && req.usuario.papel !== 'admin_fesf') {
      return res.status(400).json({ error: 'Operador sem unidade vinculada' });
    }
    if (unidadeAlvoId) {
      // Para operadores: une unidade primaria com extras de usuario_unidades
      if (req.usuario.papel === 'operador_unidade') {
        const { getUnidadesDoOperador } = await import('../services/auth-service.js');
        const todas = await getUnidadesDoOperador(req.usuario);
        // Se o admin filtrou por uma unidade especifica e o operador nao tem acesso, rejeita
        if (unidade_id && !todas.includes(Number(unidade_id))) {
          return res.status(403).json({ error: 'Operador nao tem acesso a essa unidade' });
        }
        const alvo = unidade_id ? [Number(unidade_id)] : todas;
        if (alvo.length === 1) {
          const envios = await listarEnviosUnidade(alvo[0], { origem, status, competencia, de, ate });
          return res.json({ envios });
        }
        // Multi-unit: agrega de todas
        const all = [];
        for (const uid of alvo) {
          const e = await listarEnviosUnidade(uid, { origem, status, competencia, de, ate });
          all.push(...e);
        }
        all.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
        return res.json({ envios: all });
      }
      const envios = await listarEnviosUnidade(unidadeAlvoId, { origem, status, competencia, de, ate });
      return res.json({ envios });
    }
    // admin sem filtro: lista todos
    const where = [];
    const params = [];
    if (origem)      { where.push(`e.origem = $${params.length + 1}`); params.push(origem); }
    if (status)      { where.push(`e.status = $${params.length + 1}`); params.push(status); }
    if (competencia) { where.push(`e.competencia = $${params.length + 1}`); params.push(competencia); }
    const sql = `
      SELECT e.id, e.protocolo, e.competencia, e.origem, e.status, e.valor_centavos, e.criado_em,
             f.razao_social, f.documento, f.tipo AS fornecedor_tipo,
             u.sigla AS unidade_sigla, u.nome AS unidade_nome,
             m.codigo AS modalidade_codigo, m.nome AS modalidade_nome
      FROM envios e
      LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
      JOIN modalidades m ON m.id = e.modalidade_id
      JOIN unidades u ON u.id = e.unidade_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.criado_em DESC
      LIMIT 100`;
    const { rows } = await query(sql, params);
    res.json({ envios: rows });
  } catch (e) {
    console.error('[envios/list]', e);
    res.status(500).json({ error: 'Erro ao listar' });
  }
});

/**
 * GET /api/envios/export.csv
 * Exporta CSV com mesmos filtros e escopos do GET /api/envios.
 */
router.get('/export.csv', requireAuth, async (req, res) => {
  try {
    const { origem, status, competencia, unidade_id } = req.query;
    let unidadeAlvoId = req.usuario.unidade_id;
    if (req.usuario.papel === 'admin_fesf' && unidade_id) unidadeAlvoId = Number(unidade_id);
    let envios;
    const LIMITE = 50000; // V213: limite duro alto p/ exports massivos
    if (req.usuario.papel === 'fornecedor') {
      const { rows } = await query(
        `SELECT e.protocolo, e.competencia, e.origem, e.status, e.valor_centavos, e.numero_nf, e.descricao, e.criado_em,
                u.sigla AS unidade, m.nome AS modalidade
         FROM envios e JOIN unidades u ON u.id=e.unidade_id JOIN modalidades m ON m.id=e.modalidade_id
         WHERE e.fornecedor_id=$1 ORDER BY e.criado_em DESC LIMIT $2`, [req.usuario.fornecedor_id, LIMITE + 1]);
      envios = rows;
    } else if (unidadeAlvoId) {
      envios = await listarEnviosUnidade(unidadeAlvoId, { origem, status, competencia });
    } else {
      const where = [];
      const params = [];
      if (origem)      { where.push(`e.origem = $${params.length + 1}`); params.push(origem); }
      if (status)      { where.push(`e.status = $${params.length + 1}`); params.push(status); }
      if (competencia) { where.push(`e.competencia = $${params.length + 1}`); params.push(competencia); }
      params.push(LIMITE + 1);
      const sql = `
        SELECT e.protocolo, e.competencia, e.origem, e.status, e.valor_centavos, e.numero_nf, e.descricao, e.criado_em,
               u.sigla AS unidade, m.nome AS modalidade, f.razao_social, f.documento
        FROM envios e LEFT JOIN fornecedores f ON f.id=e.fornecedor_id JOIN unidades u ON u.id=e.unidade_id JOIN modalidades m ON m.id=e.modalidade_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY e.criado_em DESC LIMIT $${params.length}`;
      envios = (await query(sql, params)).rows;
    }

    // V213: padroniza com V204/V205 — BOM UTF-8, separador ;, escape robusto.
    // Excel pt-BR agora abre direto com acentos corretos e colunas separadas.
    const truncado = envios.length > LIMITE;
    const dados = truncado ? envios.slice(0, LIMITE) : envios;

    // V213: separador eh ; entao vírgula NAO precisa escape (eh decimal BR).
    // So escapa quando tem o proprio separador ;, aspas ou quebras de linha.
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[;"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const linhas = ['protocolo;unidade;fornecedor;documento;modalidade;competencia;origem;status;valor_brl;numero_nf;descricao;criado_em'];
    for (const e of dados) {
      const valorBrl = (Number(e.valor_centavos||0)/100).toFixed(2).replace('.', ',');
      linhas.push([
        e.protocolo, e.unidade || e.unidade_sigla || '', e.razao_social || '', e.documento || '',
        e.modalidade || e.modalidade_nome || '', e.competencia, e.origem, e.status, valorBrl,
        e.numero_nf || '', e.descricao || '',
        e.criado_em instanceof Date ? e.criado_em.toISOString() : (e.criado_em || ''),
      ].map(esc).join(';'));
    }
    const csv = '﻿' + linhas.join('\r\n'); // BOM UTF-8 explicito + CRLF

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="envios-${new Date().toISOString().slice(0,10)}.csv"`);
    res.setHeader('X-Total-Count', String(dados.length));
    if (truncado) {
      res.setHeader('X-Truncated', 'true');
      res.setHeader('X-Limit', String(LIMITE));
    }
    // Auditoria do export (compliance)
    try {
      await query(
        `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
         VALUES ('sistema', 0, 'envios_exportados', $1, $2)`,
        [req.usuario.id, `${dados.length} linhas · filtros: origem=${origem||'-'} status=${status||'-'} comp=${competencia||'-'} uni=${unidade_id||'-'}`]
      );
    } catch {/* nao bloqueia o download */}
    res.send(csv);
  } catch (e) {
    console.error('[envios/csv]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/envios/resumo/origem
 * Retorna agregacao de envios por origem (Portal/Link/Manual).
 */
router.get('/resumo/origem', requireAuth, async (req, res) => {
  try {
    const { competencia, unidade_id } = req.query;
    let unidadeAlvoId = req.usuario.unidade_id;
    if (req.usuario.papel === 'admin_fesf' && unidade_id) unidadeAlvoId = Number(unidade_id);
    if (!unidadeAlvoId && req.usuario.papel === 'admin_fesf') {
      // agregado geral
      const params = [];
      let where = '';
      if (competencia) { params.push(competencia); where = 'WHERE competencia = $1'; }
      const { rows } = await query(
        `SELECT origem, COUNT(*)::int AS n, SUM(valor_centavos)::bigint AS total_centavos FROM envios ${where} GROUP BY origem ORDER BY origem`,
        params
      );
      return res.json({ por_origem: rows });
    }
    const por_origem = await resumoOrigemUnidade(unidadeAlvoId, competencia);
    res.json({ por_origem });
  } catch (e) {
    console.error('[envios/resumo]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/envios/duplicados-recentes?dias=30
 * Admin/operador detectam grupos de envios com mesma combinacao
 * (fornecedor_id, numero_nf, competencia) que escaparam a checagem
 * (foram criados antes da V201, ou via permitir_duplicado=true).
 * Operador so ve duplicatas da propria unidade.
 * IMPORTANTE: rota declarada ANTES de /:id para nao ser capturada como id.
 */
router.get('/duplicados-recentes', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const dias = Math.max(1, Math.min(365, Number(req.query.dias) || 30));
    const where = [`e.criado_em >= NOW() - INTERVAL '${dias} days'`, `e.numero_nf IS NOT NULL`];
    const params = [];
    if (req.usuario.papel === 'operador_unidade') {
      params.push(req.usuario.unidade_id);
      where.push(`e.unidade_id = $${params.length}`);
    }
    // Passo 1: encontrar (fornecedor_id, numero_nf, competencia) com count > 1.
    // Evitamos ARRAY_AGG (mais portavel entre PG/PGlite).
    const grupos = await query(
      `SELECT e.fornecedor_id, e.numero_nf, e.competencia, COUNT(*)::int AS qtd_envios,
              f.razao_social
       FROM envios e
       LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
       WHERE ${where.join(' AND ')}
       GROUP BY e.fornecedor_id, e.numero_nf, e.competencia, f.razao_social
       HAVING COUNT(*) > 1
       ORDER BY qtd_envios DESC, e.numero_nf
       LIMIT 200`,
      params
    );
    // Passo 2: para cada grupo, buscar os envios individuais (limit razoavel)
    const out = [];
    for (const g of grupos.rows) {
      const detalhes = await query(
        `SELECT id, protocolo, status, criado_em
         FROM envios
         WHERE fornecedor_id=$1 AND numero_nf=$2 AND competencia=$3
         ORDER BY criado_em`,
        [g.fornecedor_id, g.numero_nf, g.competencia]
      );
      out.push({ ...g, envios: detalhes.rows });
    }
    res.json({ grupos: out, periodo_dias: dias, total_grupos: out.length });
  } catch (e) {
    console.error('[envios/duplicados-recentes]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

/**
 * GET /api/envios/:id (detalhe)
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const envio = await queryOne(
      `SELECT e.*, f.razao_social, f.documento, f.tipo AS fornecedor_tipo,
              u.sigla AS unidade_sigla, u.nome AS unidade_nome,
              m.codigo AS modalidade_codigo, m.nome AS modalidade_nome
       FROM envios e
       LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
       JOIN unidades u ON u.id = e.unidade_id
       JOIN modalidades m ON m.id = e.modalidade_id
       WHERE e.id = $1`,
      [Number(req.params.id)]
    );
    if (!envio) return res.status(404).json({ error: 'nao encontrado' });
    // escopo: fornecedor so ve os proprios, operador so da propria unidade
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'operador_unidade') {
      const { operadorPodeAcessarUnidade } = await import('../services/auth-service.js');
      if (!(await operadorPodeAcessarUnidade(req.usuario, envio.unidade_id))) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }
    // versoes (com dados parseados da v mais recente)
    const { rows: versoes } = await query(
      `SELECT id, numero, dados_json, criada_em FROM versoes_envio WHERE envio_id=$1 ORDER BY numero`,
      [envio.id]
    );
    // parse JSON da ultima versao para mostrar as respostas do formulario
    let formData = null;
    if (versoes.length > 0) {
      const ult = versoes[versoes.length - 1];
      try { formData = JSON.parse(ult.dados_json); } catch {}
    }
    // documentos (com identidade do uploader e versao em que entrou)
    const { rows: documentos } = await query(
      `SELECT d.id, d.campo, d.nome_original, d.mime_type, d.tamanho_bytes, d.criado_em, d.uploaded_por_id, d.uploaded_por_nome,
              d.versao_id, v.numero AS versao_numero,
              d.status_validade, d.data_expiracao, d.validacao_json
       FROM documentos d
       LEFT JOIN versoes_envio v ON v.id = d.versao_id
       WHERE d.envio_id=$1 ORDER BY d.criado_em`,
      [envio.id]
    );
    // documentos esperados pela modalidade
    let documentos_esperados = [];
    try {
      const mod = await queryOne('SELECT documentos_esperados FROM modalidades WHERE id=$1', [envio.modalidade_id]);
      if (mod && mod.documentos_esperados) documentos_esperados = JSON.parse(mod.documentos_esperados);
    } catch {}
    // solicitacoes de reenvio (so para operador/admin/fornecedor do proprio envio)
    const { rows: reenvios } = await query(
      `SELECT r.id, r.campo, r.motivo, r.status, r.criado_em, r.atendido_em, u.nome AS solicitante_nome
       FROM solicitacoes_reenvio r LEFT JOIN usuarios u ON u.id = r.solicitado_por
       WHERE r.envio_id=$1 ORDER BY r.criado_em DESC`,
      [envio.id]
    );
    // pagamento (se houver)
    const pagamento = await queryOne(
      `SELECT p.id, p.numero_ted, p.banco_pagador, p.data_efetiva, p.valor_pago_centavos, p.observacao, p.comprovante_doc_id, p.criado_em, u.nome AS registrado_por_nome
       FROM pagamentos p LEFT JOIN usuarios u ON u.id = p.registrado_por_id
       WHERE p.envio_id=$1 ORDER BY p.criado_em DESC LIMIT 1`,
      [envio.id]
    );
    // auditoria
    const { rows: auditoria } = await query(
      `SELECT a.acao, a.detalhe, a.criado_em, u.nome AS usuario_nome
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.entidade='envio' AND a.entidade_id=$1
       ORDER BY a.criado_em`,
      [envio.id]
    );
    // comentarios
    const { rows: comentarios } = await query(
      `SELECT c.id, c.texto, c.criado_em, u.nome AS usuario_nome, u.papel AS usuario_papel
       FROM comentarios c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.envio_id = $1 ORDER BY c.criado_em`,
      [envio.id]
    );
    // anotacoes de analise (so operadores/admin veem; fornecedor nao)
    let anotacoes = [];
    let anotacoes_documento = [];
    if (req.usuario.papel !== 'fornecedor') {
      // V231/O2: retorna autor original + último que tocou + timestamps de cada
      const r = await query(
        `SELECT a.id, a.campo, a.status, a.observacao, a.criado_em, a.atualizado_em,
                u.nome AS operador_nome,
                u2.nome AS criado_por_nome,
                (a.criado_por_id IS NOT NULL AND a.operador_id <> a.criado_por_id) AS editada_por_outro
         FROM anotacoes_envio a
         LEFT JOIN usuarios u  ON u.id  = a.operador_id
         LEFT JOIN usuarios u2 ON u2.id = a.criado_por_id
         WHERE a.envio_id=$1 ORDER BY a.atualizado_em DESC`,
        [envio.id]
      );
      anotacoes = r.rows;
      const rd = await query(
        `SELECT ad.id, ad.documento_id, ad.status, ad.observacao, ad.criado_em, ad.atualizado_em,
                u.nome AS operador_nome,
                u2.nome AS criado_por_nome,
                (ad.criado_por_id IS NOT NULL AND ad.operador_id <> ad.criado_por_id) AS editada_por_outro
         FROM anotacoes_documento ad
         LEFT JOIN usuarios u  ON u.id  = ad.operador_id
         LEFT JOIN usuarios u2 ON u2.id = ad.criado_por_id
         WHERE ad.envio_id=$1`,
        [envio.id]
      );
      anotacoes_documento = rd.rows;
    }
    // V300: complementos pendentes (FGTS/INSS pos-pagamento)
    let complementos_pendentes = [];
    try {
      const { listarComplementosDoEnvio } = await import('../services/complementos-service.js');
      complementos_pendentes = await listarComplementosDoEnvio(envio.id);
    } catch (e) { console.error('[envios/detalhe/complementos]', e.message); }
    res.json({ envio, versoes, documentos, documentos_esperados, reenvios, pagamento, auditoria, comentarios, form_data: formData, anotacoes, anotacoes_documento, complementos_pendentes });
  } catch (e) {
    console.error('[envios/get]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/bulk/aprovar
 * Aprovacao em massa. {ids: [...]}. Cada envio respeita escopo do usuario.
 */
router.post('/bulk/aprovar', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] obrigatorio' });
    if (ids.length > 100) return res.status(400).json({ error: 'maximo 100 por chamada' });
    const aprovados = [];
    const erros = [];
    for (const id of ids) {
      try {
        const r = await mudarStatusEnvio({ envioId: Number(id), novoStatus: 'aprovado', usuarioId: req.usuario.id });
        aprovados.push(r.id);
      } catch (e) {
        erros.push({ id, erro: e.message, code: e.code });
      }
    }
    res.json({ aprovados, erros, total_solicitado: ids.length });
  } catch (e) {
    console.error('[envios/bulk]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/bulk/marcar-pago (admin FESF only)
 * Marca varios envios aprovados como pagos. Body: {ids: [], observacao?}
 */
router.post('/bulk/marcar-pago', requireAuth, requireRole('admin_fesf'), async (req, res) => {
  try {
    const { ids, observacao } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] obrigatorio' });
    if (ids.length > 100) return res.status(400).json({ error: 'maximo 100 por chamada' });
    const pagos = [];
    const erros = [];
    for (const id of ids) {
      try {
        const e = await queryOne('SELECT status FROM envios WHERE id=$1', [Number(id)]);
        if (!e) { erros.push({ id, erro: 'nao encontrado' }); continue; }
        if (e.status !== 'aprovado') { erros.push({ id, erro: `status atual ${e.status}, precisa estar aprovado` }); continue; }
        const r = await mudarStatusEnvio({ envioId: Number(id), novoStatus: 'pago', usuarioId: req.usuario.id, motivo: observacao || 'pagamento em lote' });
        pagos.push(r.id);
      } catch (e) {
        erros.push({ id, erro: e.message, code: e.code });
      }
    }
    res.json({ pagos, erros, total_solicitado: ids.length });
  } catch (e) {
    console.error('[envios/bulk-pagar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/marcar-pago (admin FESF only)
 * Marca envio aprovado como pago. So funciona se status atual eh 'aprovado'.
 */
router.post('/:id/marcar-pago', requireAuth, requireRole('admin_fesf'), idempotency('envios.marcar-pago'), async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const envio = await queryOne('SELECT * FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (envio.status !== 'aprovado') {
      return res.status(400).json({ error: 'Envio precisa estar aprovado para ser marcado como pago' });
    }
    const { numero_ted, banco_pagador, data_efetiva, valor_pago_centavos, observacao, comprovante_doc_id, confirmar_complementos_pendentes } = req.body || {};
    // V300: se ha complementos pendentes (FGTS/INSS), exige confirmacao explicita
    try {
      const { contarPendentesDoEnvio, listarComplementosDoEnvio } = await import('../services/complementos-service.js');
      const nPendentes = await contarPendentesDoEnvio(envioId);
      if (nPendentes > 0 && !confirmar_complementos_pendentes) {
        const lista = await listarComplementosDoEnvio(envioId);
        return res.status(409).json({
          error: `Existem ${nPendentes} complemento(s) pendente(s) (FGTS/INSS) ainda nao recebido(s). Confirme o pagamento antecipado enviando confirmar_complementos_pendentes=true.`,
          code: 'COMPLEMENTOS_PENDENTES',
          complementos: lista.filter(x => x.status === 'pendente'),
        });
      }
    } catch (e) {
      if (e?.code === 'COMPLEMENTOS_PENDENTES') throw e;
      console.error('[envios/marcar-pago/complementos]', e.message);
    }
    // Se enviou dados estruturados, valida e grava pagamento
    if (numero_ted || banco_pagador || data_efetiva) {
      if (!numero_ted || !banco_pagador || !data_efetiva) {
        return res.status(400).json({ error: 'numero_ted, banco_pagador e data_efetiva sao obrigatorios juntos' });
      }
      const valor = Number(valor_pago_centavos) || Number(envio.valor_centavos) || 0;
      await query(
        `INSERT INTO pagamentos (envio_id, numero_ted, banco_pagador, data_efetiva, valor_pago_centavos, observacao, comprovante_doc_id, registrado_por_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [envioId, numero_ted, banco_pagador, data_efetiva, valor, observacao || null, comprovante_doc_id || null, req.usuario.id]
      );
    }
    const motivoStr = numero_ted ? `TED ${numero_ted} · ${banco_pagador} · ${data_efetiva}${observacao ? ' · ' + observacao : ''}` : (observacao || 'pagamento processado');
    const r = await mudarStatusEnvio({
      envioId, novoStatus: 'pago',
      usuarioId: req.usuario.id, motivo: motivoStr,
    });
    res.json(r);
  } catch (e) {
    console.error('[envios/marcar-pago]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/aprovar (operador da unidade ou admin)
 */
router.post('/:id/aprovar', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const r = await mudarStatusEnvio({
      envioId: Number(req.params.id), novoStatus: 'aprovado',
      usuarioId: req.usuario.id, motivo: req.body?.observacao,
    });
    res.json(r);
  } catch (e) {
    if (e.code === 'FORBIDDEN' || e.code === 'WRONG_UNIT') return res.status(403).json({ error: e.message });
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: e.message });
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/rejeitar (com motivo)
 */
router.post('/:id/rejeitar', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const r = await mudarStatusEnvio({
      envioId: Number(req.params.id), novoStatus: 'rejeitado',
      usuarioId: req.usuario.id, motivo: req.body?.motivo,
    });
    res.json(r);
  } catch (e) {
    if (e.code === 'MOTIVO_INVALID') return res.status(400).json({ error: e.message });
    if (e.code === 'FORBIDDEN' || e.code === 'WRONG_UNIT') return res.status(403).json({ error: e.message });
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/solicitar-retificacao
 */
router.post('/:id/solicitar-retificacao', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const r = await mudarStatusEnvio({
      envioId: Number(req.params.id), novoStatus: 'aguardando_ret',
      usuarioId: req.usuario.id, motivo: req.body?.motivo,
    });
    res.json(r);
  } catch (e) {
    if (e.code === 'MOTIVO_INVALID') return res.status(400).json({ error: e.message });
    if (e.code === 'FORBIDDEN' || e.code === 'WRONG_UNIT') return res.status(403).json({ error: e.message });
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/versoes (fornecedor envia nova versao apos retificacao)
 */
router.post('/:id/versoes', requireAuth, async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const envio = await queryOne('SELECT fornecedor_id, unidade_id FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'nao encontrado' });
    // fornecedor: so do proprio envio; operador/admin: livre
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const v = await criarNovaVersao({
      envioId, dadosJson: req.body || {}, usuarioId: req.usuario.id,
    });
    res.status(201).json({ versao: v });
  } catch (e) {
    console.error('[envios/versoes]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * PUT /api/envios/:id/dados-manual
 * Edicao direta de envios manuais pelo proprio operador/admin (sem precisar
 * solicitar retificacao ao fornecedor). Cria nova versao registrada em nome
 * do operador. Funciona apenas para envios com origem=manual.
 */
router.put('/:id/dados-manual', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const envio = await queryOne('SELECT * FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });

    if (envio.origem !== 'manual') {
      return res.status(422).json({
        error: 'Esta operacao so vale para envios criados manualmente pelo operador. Envios do portal/link publico exigem solicitar retificacao ao fornecedor.',
        code: 'ORIGEM_NAO_MANUAL',
      });
    }
    if (['aprovado', 'rejeitado', 'pago'].includes(envio.status)) {
      return res.status(422).json({
        error: 'Envios em estado terminal (aprovado/rejeitado/pago) nao podem ser editados',
        code: 'ESTADO_TERMINAL',
      });
    }
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { valor_centavos, numero_nf, descricao, motivo, campos_revisados } = req.body || {};
    if (!motivo || String(motivo).trim().length < 5) {
      return res.status(400).json({ error: 'motivo da correcao obrigatorio (>=5 chars)' });
    }

    // Monta dados_json da nova versao mesclando o atual + novos campos
    const dadosNovaVersao = {
      valor_centavos: valor_centavos != null ? Number(valor_centavos) : envio.valor_centavos,
      numero_nf:      numero_nf      != null ? String(numero_nf)      : envio.numero_nf,
      descricao:      descricao      != null ? String(descricao)      : envio.descricao,
      motivo:         String(motivo).trim(),
      campos_revisados: Array.isArray(campos_revisados) ? campos_revisados : undefined,
      editado_por:    'operador_manual',
    };

    const v = await criarNovaVersao({
      envioId, dadosJson: dadosNovaVersao, usuarioId: req.usuario.id,
    });

    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
       VALUES ('envio', $1, 'edicao_manual_operador', $2, $3)`,
      [envioId, req.usuario.id, `v${v.numero} - motivo: ${String(motivo).substring(0, 100)}`]
    );

    res.status(201).json({ ok: true, versao: v });
  } catch (e) {
    console.error('[envios/dados-manual]', e);
    res.status(500).json({ error: 'Erro ao atualizar dados do envio' });
  }
});

/**
 * POST /api/envios/:id/complementos
 * Fornecedor (ou operador) sinaliza que vai enviar um documento depois (FGTS, INSS).
 * Body: { campos: ['gps','fgts'] }
 */
router.post('/:id/complementos', requireAuth, async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const envio = await queryOne('SELECT fornecedor_id, unidade_id, competencia FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const campos = Array.isArray(req.body.campos) ? req.body.campos : [];
    if (campos.length === 0) return res.status(400).json({ error: 'campos obrigatorio (array)' });
    const { registrarComplementos } = await import('../services/complementos-service.js');
    const criados = await registrarComplementos({
      envioId, campos, competencia: envio.competencia, criadoPorId: req.usuario.id,
    });
    res.status(201).json({ criados, total: criados.length });
  } catch (e) {
    console.error('[envios/complementos/add]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * DELETE /api/envios/:id/complementos/:complId — remove complemento pendente (cancela)
 */
router.delete('/:id/complementos/:complId', requireAuth, async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const complId = Number(req.params.complId);
    const envio = await queryOne('SELECT fornecedor_id, unidade_id FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const r = await query(
      `DELETE FROM complementos_pendentes WHERE id = $1 AND envio_id = $2 AND status = 'pendente'`,
      [complId, envioId]
    );
    res.json({ ok: true, deleted: r.rowCount || 0 });
  } catch (e) {
    console.error('[envios/complementos/del]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/envios/:id/documentos/:docId/preview
 * Serve o arquivo inline (sem Content-Disposition attachment) para iframe/imagem.
 */
router.get('/:id/documentos/:docId/preview', requireAuth, async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const docId = Number(req.params.docId);
    const envio = await queryOne('SELECT fornecedor_id, unidade_id FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) return res.status(403).json({ error: 'Acesso negado' });
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) return res.status(403).json({ error: 'Acesso negado' });
    const doc = await queryOne('SELECT * FROM documentos WHERE id=$1 AND envio_id=$2', [docId, envioId]);
    if (!doc) return res.status(404).json({ error: 'documento nao encontrado' });
    // V292: caminho pode ser local OU "onedrive://item-id" — usa storage helper
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.nome_original)}"`);
    if (doc.caminho && doc.caminho.includes('://')) {
      try {
        const { obterBuffer } = await import('../services/storage-service.js');
        const buf = await obterBuffer(doc.caminho);
        return res.send(buf);
      } catch (e) {
        if (!res.headersSent) return res.status(502).json({ error: 'Falha ao baixar do storage: ' + e.message });
        return;
      }
    }
    // Local: valida que o arquivo existe ANTES (V224 fix)
    try { await access(doc.caminho); }
    catch { return res.status(410).json({ error: 'Arquivo não disponível no servidor (pode ter sido removido)' }); }
    res.sendFile(doc.caminho, (err) => {
      if (err) console.error('[envios/preview/sendFile]', err.message);
    });
  } catch (e) {
    console.error('[envios/preview]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/envios/:id/documentos/:docId/download
 * Faz download do arquivo, respeitando escopo do papel.
 */
router.get('/:id/documentos/:docId/download', requireAuth, async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const docId = Number(req.params.docId);
    const envio = await queryOne('SELECT fornecedor_id, unidade_id FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    // escopo
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const doc = await queryOne(
      `SELECT * FROM documentos WHERE id=$1 AND envio_id=$2`,
      [docId, envioId]
    );
    if (!doc) return res.status(404).json({ error: 'documento nao encontrado' });
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.nome_original)}"`);
    // V292: OneDrive ou local
    if (doc.caminho && doc.caminho.includes('://')) {
      try {
        const { obterBuffer } = await import('../services/storage-service.js');
        const buf = await obterBuffer(doc.caminho);
        return res.send(buf);
      } catch (e) {
        if (!res.headersSent) return res.status(502).json({ error: 'Falha ao baixar do storage: ' + e.message });
        return;
      }
    }
    // V224: valida arquivo no disco antes de mexer em headers
    try { await access(doc.caminho); }
    catch { return res.status(410).json({ error: 'Arquivo não disponível no servidor (pode ter sido removido)' }); }
    res.sendFile(doc.caminho, (err) => {
      if (err) console.error('[envios/download/sendFile]', err.message);
    });
  } catch (e) {
    console.error('[envios/download]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/anotacoes (operador/admin)
 * Cria ou atualiza anotacao de analise em um campo do formulario.
 * Body: { campo, status: 'verificado|duvida|problema', observacao? }
 */
router.post('/:id/anotacoes', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const { campo, status, observacao } = req.body || {};
    if (!campo) return res.status(400).json({ error: 'campo obrigatorio' });
    if (!['verificado','duvida','problema','comentario'].includes(status)) return res.status(400).json({ error: 'status invalido' });
    const envio = await queryOne('SELECT unidade_id FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) return res.status(403).json({ error: 'Acesso negado' });
    const existe = await queryOne('SELECT id FROM anotacoes_envio WHERE envio_id=$1 AND campo=$2', [envioId, campo]);
    if (existe) {
      // V231/O2: operador_id = quem está editando AGORA. criado_por_id intocado.
      await query('UPDATE anotacoes_envio SET status=$1, observacao=$2, operador_id=$3, atualizado_em=CURRENT_TIMESTAMP WHERE id=$4',
        [status, observacao || null, req.usuario.id, existe.id]);
    } else {
      // V231/O2: criado_por_id = operador_id no INSERT (mesma pessoa)
      await query('INSERT INTO anotacoes_envio (envio_id, campo, status, observacao, operador_id, criado_por_id) VALUES ($1,$2,$3,$4,$5,$5)',
        [envioId, campo, status, observacao || null, req.usuario.id]);
    }
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('envio', $1, 'campo_anotado', $2, $3)`,
      [envioId, req.usuario.id, `${campo}=${status}${observacao ? ' · ' + observacao.substring(0,80) : ''}`]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[envios/anotacoes]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/solicitar-reenvio (operador/admin)
 * Cria pedido de reenvio de um documento. Notifica o fornecedor.
 * Body: { campo, motivo, documento_id? }
 */
router.post('/:id/solicitar-reenvio', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const { campo, motivo, documento_id, prazo_dias } = req.body || {};
    if (!campo) return res.status(400).json({ error: 'campo obrigatorio' });
    if (!motivo || motivo.trim().length < 5) return res.status(400).json({ error: 'motivo obrigatorio (>=5 chars)' });
    // V228/O3.2: prazo de atendimento (default 3 dias, faixa 1-30)
    const prazoDias = prazo_dias == null ? 3 : Number(prazo_dias);
    if (!Number.isInteger(prazoDias) || prazoDias < 1 || prazoDias > 30) {
      return res.status(400).json({ error: 'prazo_dias deve ser inteiro entre 1 e 30 (default 3)' });
    }
    const envio = await queryOne('SELECT * FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) return res.status(403).json({ error: 'Acesso negado' });
    // V222/O3: se documento_id veio, pegamos o nome para incluir na notificacao
    // ("Reenvie nf-marco.pdf" e mais util que "Reenvie o campo q5_nf").
    let docNome = null;
    if (documento_id) {
      const d = await queryOne('SELECT nome_original FROM documentos WHERE id=$1', [documento_id]);
      if (d) docNome = d.nome_original;
    }
    // V228/O3.2: tentativas = count(anteriores aberta/cancelada do mesmo campo) + 1.
    // Soluções anteriores marcadas como "atendida" zeram a contagem? Não — manter
    // histórico cumulativo de quantas vezes o operador precisou pedir.
    const { rows: anteriores } = await query(
      `SELECT COUNT(*)::int AS n FROM solicitacoes_reenvio
       WHERE envio_id=$1 AND campo=$2`,
      [envioId, campo]
    );
    const tentativas = (anteriores[0]?.n || 0) + 1;
    const prazoTs = new Date(Date.now() + prazoDias * 86400000).toISOString();
    await query(
      `INSERT INTO solicitacoes_reenvio
         (envio_id, documento_id, campo, motivo, solicitado_por, prazo_atendimento, tentativas)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [envioId, documento_id || null, campo, motivo.trim(), req.usuario.id, prazoTs, tentativas]
    );

    // Atualiza status do envio: dá visibilidade que está aguardando o fornecedor
    await query(
      `UPDATE envios SET status = 'aguardando_ret', atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $1 AND status NOT IN ('aprovado', 'rejeitado', 'pago')`,
      [envioId]
    );
    const detalhe = `campo=${campo}${docNome ? ' (' + docNome + ')' : ''} · tentativa ${tentativas} · prazo ${prazoDias}d · ${motivo.substring(0,60)}`;
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('envio', $1, 'reenvio_solicitado', $2, $3)`,
      [envioId, req.usuario.id, detalhe]
    );
    // Notifica fornecedor — agora menciona prazo + tentativa quando relevante
    const { notificar } = await import('../services/notificacao-service.js');
    const { rows: usrs } = await query(`SELECT id FROM usuarios WHERE fornecedor_id=$1 AND ativo=TRUE`, [envio.fornecedor_id]);
    const alvo = docNome ? `arquivo "${docNome}" (campo ${campo})` : `campo ${campo}`;
    const sufixoTentativa = tentativas > 1 ? ` (${tentativas}ª solicitação)` : '';
    const dataPrazoBR = new Date(prazoTs).toLocaleDateString('pt-BR');
    for (const u of usrs) {
      await notificar({
        usuarioId: u.id, tipo: 'sistema',
        mensagem: `Reenvio solicitado no envio ${envio.protocolo}${sufixoTentativa} — ${alvo}. Prazo: ${dataPrazoBR}. Motivo: ${motivo.substring(0,120)}`,
        entidade: 'envio', entidadeId: envioId,
      });
    }
    res.status(201).json({
      ok: true,
      fornecedor_usuarios_notificados: usrs.length,
      documento_nome: docNome,
      tentativas, prazo_atendimento: prazoTs,
    });
  } catch (e) {
    console.error('[envios/reenvio]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * GET /api/envios/:id/reenvios
 * V228/O3.2: lista solicitações de reenvio do envio (operador da unidade, admin, fornecedor dono).
 */
router.get('/:id/reenvios', requireAuth, async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const envio = await queryOne('SELECT fornecedor_id, unidade_id FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) return res.status(403).json({ error: 'Acesso negado' });
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) return res.status(403).json({ error: 'Acesso negado' });
    const { rows } = await query(
      `SELECT sr.id, sr.campo, sr.motivo, sr.status, sr.tentativas, sr.prazo_atendimento,
              sr.criado_em, sr.atendido_em,
              sr.documento_id, d.nome_original AS documento_nome,
              u.nome AS solicitado_por_nome
       FROM solicitacoes_reenvio sr
       LEFT JOIN documentos d ON d.id = sr.documento_id
       LEFT JOIN usuarios u ON u.id = sr.solicitado_por
       WHERE sr.envio_id=$1
       ORDER BY sr.criado_em DESC`,
      [envioId]
    );
    res.json({ reenvios: rows });
  } catch (e) {
    console.error('[envios/reenvios/list]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/documentos/:docId/anotacao (operador/admin)
 * Marca um documento individual como verificado/duvida/problema.
 * Body: { status, observacao? }
 */
router.post('/:id/documentos/:docId/anotacao', requireAuth, requireRole('operador_unidade', 'admin_fesf'), async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const docId = Number(req.params.docId);
    const { status, observacao } = req.body || {};
    if (!['verificado','duvida','problema','comentario'].includes(status)) return res.status(400).json({ error: 'status invalido' });
    const envio = await queryOne('SELECT unidade_id FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) return res.status(403).json({ error: 'Acesso negado' });
    const doc = await queryOne('SELECT id FROM documentos WHERE id=$1', [docId]);
    if (!doc) return res.status(404).json({ error: 'documento nao encontrado' });
    const existe = await queryOne('SELECT id FROM anotacoes_documento WHERE documento_id=$1', [docId]);
    if (existe) {
      // V231/O2: operador_id = quem editou agora. criado_por_id intocado.
      await query('UPDATE anotacoes_documento SET status=$1, observacao=$2, operador_id=$3, atualizado_em=CURRENT_TIMESTAMP WHERE id=$4',
        [status, observacao || null, req.usuario.id, existe.id]);
    } else {
      await query('INSERT INTO anotacoes_documento (documento_id, envio_id, status, observacao, operador_id, criado_por_id) VALUES ($1,$2,$3,$4,$5,$5)',
        [docId, envioId, status, observacao || null, req.usuario.id]);
    }
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('envio', $1, 'documento_anotado', $2, $3)`,
      [envioId, req.usuario.id, `doc=${docId} status=${status}${observacao ? ' · ' + observacao.substring(0,80) : ''}`]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[envios/doc-anot]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/encaminhar-sede
 * Operador encaminha o envio para analise pela FESF Sede.
 * Cria comentario + notificacao para todos os admin_fesf.
 */
router.post('/:id/encaminhar-sede', requireAuth, requireRole('operador_unidade'), async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const { motivo } = req.body || {};
    if (!motivo || motivo.trim().length < 5) return res.status(400).json({ error: 'motivo obrigatorio (>=5 chars)' });
    const envio = await queryOne('SELECT * FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) return res.status(403).json({ error: 'Acesso negado' });
    // marca envio como encaminhado (atualiza campo de auditoria)
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('envio', $1, 'encaminhado_sede', $2, $3)`,
      [envioId, req.usuario.id, motivo.substring(0, 200)]
    );
    // Cria comentario na thread
    await query(
      `INSERT INTO comentarios (envio_id, usuario_id, texto) VALUES ($1,$2,$3)`,
      [envioId, req.usuario.id, `🔺 Encaminhado para FESF Sede: ${motivo}`]
    );
    // Notifica todos admins
    const { rows: admins } = await query(`SELECT id FROM usuarios WHERE papel='admin_fesf' AND ativo=TRUE`);
    const { notificar } = await import('../services/notificacao-service.js');
    for (const a of admins) {
      await notificar({
        usuarioId: a.id, tipo: 'sistema',
        mensagem: `Envio ${envio.protocolo} encaminhado pela unidade para análise da FESF Sede`,
        entidade: 'envio', entidadeId: envioId,
      });
    }
    res.json({ ok: true, admins_notificados: admins.length });
  } catch (e) {
    console.error('[envios/encaminhar]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/comentarios
 * Cria comentario na thread do envio. Notifica a outra ponta.
 */
router.post('/:id/comentarios', requireAuth, rateLimit({ max: 30, windowMs: 60_000, key: 'envios.comentarios', byUser: true }), async (req, res) => {
  try {
    const envioId = Number(req.params.id);
    const { texto } = req.body || {};
    if (!texto || texto.trim().length < 2) return res.status(400).json({ error: 'texto invalido' });
    const envio = await queryOne('SELECT * FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    // escopo
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const { rows: [c] } = await query(
      `INSERT INTO comentarios (envio_id, usuario_id, texto) VALUES ($1,$2,$3) RETURNING *`,
      [envioId, req.usuario.id, texto.trim()]
    );
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('envio', $1, 'comentario_adicionado', $2, $3)`,
      [envioId, req.usuario.id, texto.substring(0, 100)]
    );
    // Notifica a outra ponta: se o autor for fornecedor, notifica operadores da unidade; se operador/admin, notifica fornecedor
    const { notificarOperadoresUnidade, notificarFornecedor } = await import('../services/notificacao-service.js');
    if (req.usuario.papel === 'fornecedor') {
      await notificarOperadoresUnidade({
        unidadeId: envio.unidade_id,
        // V214/F3.1: tipo "novo_comentario" (em vez de "sistema") para que V192
        // notif-prefs.comentarios consiga filtrar opt-out individualmente.
        tipo: 'novo_comentario',
        mensagem: `Novo comentário no envio ${envio.protocolo}`,
        link: `/app/painel.html?envio=${envioId}`,
        entidade: 'envio', entidadeId: envioId,
      });
    } else {
      await notificarFornecedor({
        fornecedorId: envio.fornecedor_id,
        tipo: 'novo_comentario',
        mensagem: `Novo comentário no envio ${envio.protocolo}`,
        link: `/app/portal.html?envio=${envioId}`,
        entidade: 'envio', entidadeId: envioId,
      });
    }
    res.status(201).json({ comentario: c });
  } catch (e) {
    console.error('[envios/comentarios]', e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * POST /api/envios/:id/documentos (upload)
 */
router.post('/:id/documentos', requireAuth, rateLimit({ max: 120, windowMs: 60_000, key: 'envios.upload', byUser: true }), upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'arquivo obrigatorio' });
    const envioId = Number(req.params.id);
    const envio = await queryOne('SELECT fornecedor_id, unidade_id FROM envios WHERE id=$1', [envioId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (req.usuario.papel === 'fornecedor' && envio.fornecedor_id !== req.usuario.fornecedor_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.papel === 'operador_unidade' && envio.unidade_id !== req.usuario.unidade_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const usr = await queryOne('SELECT nome FROM usuarios WHERE id=$1', [req.usuario.id]);
    // versao atual do envio (ultima versao registrada)
    const ultVers = await queryOne('SELECT id FROM versoes_envio WHERE envio_id=$1 ORDER BY numero DESC LIMIT 1', [envioId]);
    // Calcula hash SHA-256 do conteudo e verifica duplicata em outros envios
    let hash = null;
    let duplicatas = [];
    try {
      const buf = await readFile(req.file.path);
      hash = createHash('sha256').update(buf).digest('hex');
      const { rows: dups } = await query(
        `SELECT d.id, d.envio_id, e.protocolo, d.criado_em
         FROM documentos d JOIN envios e ON e.id=d.envio_id
         WHERE d.hash_sha256=$1 AND d.envio_id<>$2
         LIMIT 5`,
        [hash, envioId]
      );
      duplicatas = dups;
    } catch {}
    // V292: tenta subir para OneDrive/SharePoint se configurado; senão fica local
    const { subirArquivo } = await import('../services/storage-service.js');
    const upRes = await subirArquivo(req.file.path, req.file.originalname, req.file.mimetype);
    const caminhoSalvo = upRes.caminho;
    const { rows: [doc] } = await query(
      `INSERT INTO documentos (envio_id, versao_id, campo, nome_original, mime_type, tamanho_bytes, caminho, hash_sha256, uploaded_por_id, uploaded_por_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [envioId, ultVers?.id || null, req.body.campo || 'anexo', req.file.originalname, req.file.mimetype, req.file.size, caminhoSalvo, hash, req.usuario.id, usr?.nome || null]
    );
    // V228/O3.2: se existe solicitação de reenvio em aberto para esse campo,
    // marca como atendida (fornecedor atendeu o pedido do operador).
    try {
      await query(
        `UPDATE solicitacoes_reenvio
         SET status='atendida', atendido_em=CURRENT_TIMESTAMP
         WHERE envio_id=$1 AND campo=$2 AND status='aberta'`,
        [envioId, doc.campo]
      );
    } catch {}
    // Se ha duplicata, notifica operadores da unidade (alerta de fraude potencial)
    if (duplicatas.length > 0) {
      const { rows: ops } = await query(
        `SELECT id FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1 AND ativo=TRUE`,
        [envio.unidade_id]
      );
      const { notificar } = await import('../services/notificacao-service.js');
      const refs = duplicatas.map(d => d.protocolo).join(', ');
      for (const op of ops) {
        await notificar({
          usuarioId: op.id, tipo: 'sistema',
          mensagem: `⚠ Arquivo "${req.file.originalname}" já apareceu em: ${refs}. Verifique se há reutilização indevida.`,
          entidade: 'envio', entidadeId: envioId,
        });
      }
      await query(
        `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('envio', $1, 'documento_duplicado_detectado', $2, $3)`,
        [envioId, req.usuario.id, `hash=${hash.substring(0,12)}... refs=${refs}`]
      );
    }
    // Se este upload atende uma solicitacao de reenvio aberta no mesmo campo, fecha-a
    await query(
      `UPDATE solicitacoes_reenvio SET status='atendida', atendido_em=CURRENT_TIMESTAMP
       WHERE envio_id=$1 AND campo=$2 AND status='aberta'`,
      [envioId, req.body.campo || 'anexo']
    );
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('envio', $1, 'documento_anexado', $2, $3)`,
      [envioId, req.usuario.id, `${req.file.originalname} (${req.file.size} bytes)`]
    );
    // Validação assíncrona em background (fire-and-forget)
    try {
      const { dispararValidacaoBackground, obterCertidaoConfig } = await import('../services/validacao-documentos-service.js');
      const cfg = await obterCertidaoConfig();
      if (cfg.validacao_ativa !== false) dispararValidacaoBackground(doc.id);
    } catch {}

    // V300: se este upload atende algum complemento pendente, marca como recebido
    try {
      const { marcarComplementoRecebido } = await import('../services/complementos-service.js');
      await marcarComplementoRecebido({ envioId, campo: doc.campo, documentoId: doc.id });
    } catch (e) { console.error('[envios/upload/complemento]', e.message); }

    res.status(201).json({
      documento: { id: doc.id, campo: doc.campo, nome_original: doc.nome_original },
      duplicatas: duplicatas.map(d => ({ envio_id: d.envio_id, protocolo: d.protocolo })),
    });
  } catch (e) {
    console.error('[envios/upload]', e);
    res.status(500).json({ error: 'Erro no upload' });
  }
});

/**
 * POST /api/envios/publico/:token/:envioId/documentos
 * V221: upload via link público (anônimo). Validamos que o envio pertence
 * a esse token (link_publico_id) — sem isso, qualquer token poderia subir
 * arquivos em qualquer envio. Sem rate-limit-byUser (não há usuario), só por IP.
 */
router.post('/publico/:token/:envioId/documentos',
  rateLimit({ max: 60, windowMs: 60_000, key: 'envios.upload.publico' }),
  upload.single('arquivo'),
  async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'arquivo obrigatorio' });
    const { token, envioId } = req.params;
    const envId = Number(envioId);
    // Resolve link e verifica binding
    // V227/O6: valida também expira_em (upload tem que respeitar TTL do link)
    const link = await queryOne('SELECT id, revogado, fornecedor_id, expira_em FROM links_publicos WHERE token=$1', [token]);
    if (!link) return res.status(404).json({ error: 'link invalido' });
    if (link.revogado) return res.status(403).json({ error: 'link revogado' });
    if (link.expira_em && new Date(link.expira_em) < new Date()) {
      return res.status(403).json({ error: 'link expirado' });
    }
    const envio = await queryOne('SELECT id, link_publico_id FROM envios WHERE id=$1', [envId]);
    if (!envio) return res.status(404).json({ error: 'envio nao encontrado' });
    if (envio.link_publico_id !== link.id) {
      return res.status(403).json({ error: 'envio nao pertence a este link publico' });
    }
    // Tudo OK: grava documento como o endpoint autenticado
    const campo = req.body.campo || 'anexo';
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(req.file.path);
    const hash = createHash('sha256').update(buf).digest('hex');
    // V296: usar storage-service também no upload via link público (era só local, agora respeita OneDrive)
    const { subirArquivo } = await import('../services/storage-service.js');
    const upRes = await subirArquivo(req.file.path, req.file.originalname, req.file.mimetype);
    const caminhoSalvo = upRes.caminho;
    const { rows: [doc] } = await query(
      `INSERT INTO documentos (envio_id, campo, nome_original, caminho, tamanho_bytes, mime_type, hash_sha256, uploaded_por_id, uploaded_por_nome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8) RETURNING id, campo, nome_original`,
      [envId, campo, req.file.originalname, caminhoSalvo, req.file.size, req.file.mimetype || null, hash, '[via link publico]']
    );
    // V228/O3.2: marca solicitação aberta como atendida (fornecedor reenviou via link público)
    try {
      await query(
        `UPDATE solicitacoes_reenvio
         SET status='atendida', atendido_em=CURRENT_TIMESTAMP
         WHERE envio_id=$1 AND campo=$2 AND status='aberta'`,
        [envId, doc.campo]
      );
    } catch {}
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
       VALUES ('envio', $1, 'documento_anexado', NULL, $2)`,
      [envId, `[publico] ${req.file.originalname} (${req.file.size} bytes)`]
    );
    res.status(201).json({ documento: doc });
  } catch (e) {
    console.error('[envios/upload/publico]', e);
    res.status(500).json({ error: 'Erro no upload' });
  }
});

export default router;
