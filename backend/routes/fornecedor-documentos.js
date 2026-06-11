/**
 * fornecedor-documentos.js
 * -------------------------
 * CRUD de documentos fixos do fornecedor (cartão CNPJ, proposta comercial,
 * contrato). Esses documentos são enviados uma vez e reutilizados em todos
 * os envios mensais — sem necessidade de reenviar a cada competência.
 *
 * Endpoints:
 *   POST   /api/fornecedores/:id/documentos-fixos           → upload
 *   GET    /api/fornecedores/:id/documentos-fixos           → listar
 *   DELETE /api/fornecedores/:id/documentos-fixos/:docId    → soft-delete
 *   GET    /api/fornecedores/:id/documentos-fixos/:docId/download → download
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../services/auth-service.js';
import { query, queryOne } from '../db/index.js';
import multer from 'multer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { rateLimit } from '../services/rate-limit-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '..', '.uploads');
await mkdir(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    cb(null, ok);
  },
});

const router = Router();

// ---------------------------------------------------------------------------
// Helpers de autorização
// ---------------------------------------------------------------------------

/**
 * Verifica se o usuário autenticado pode acessar os documentos fixos
 * do fornecedor :id.
 *  - Fornecedor: só o próprio (via fornecedor_id)
 *  - Operador/admin: qualquer fornecedor vinculado à sua unidade
 */
async function verificarAcesso(req, res, fornecedorId) {
  const { papel, fornecedor_id, unidade_id, id: usuarioId } = req.usuario;

  if (papel === 'fornecedor') {
    if (Number(fornecedor_id) !== Number(fornecedorId)) {
      res.status(403).json({ error: 'Acesso negado' });
      return false;
    }
    return true;
  }

  if (papel === 'admin_fesf') return true;

  if (papel === 'operador_unidade') {
    // Verifica se o fornecedor está vinculado à unidade do operador
    const vinculo = await queryOne(
      `SELECT 1 FROM fornecedor_unidades
       WHERE fornecedor_id = $1
         AND unidade_id IN (
           SELECT unidade_id FROM usuario_unidades WHERE usuario_id = $2
           UNION SELECT $3 WHERE $3 IS NOT NULL
         )`,
      [fornecedorId, usuarioId, unidade_id]
    );
    if (!vinculo) {
      res.status(403).json({ error: 'Fornecedor não vinculado à sua unidade' });
      return false;
    }
    return true;
  }

  res.status(403).json({ error: 'Acesso negado' });
  return false;
}

// ---------------------------------------------------------------------------
// POST /api/fornecedores/:id/documentos-fixos
// Upload de novo documento fixo
// ---------------------------------------------------------------------------
router.post(
  '/:id/documentos-fixos',
  requireAuth,
  rateLimit({ max: 30, windowMs: 60_000, key: 'forn.docs-fixos.upload', byUser: true }),
  upload.single('arquivo'),
  async (req, res) => {
    try {
      const fornecedorId = Number(req.params.id);
      if (!await verificarAcesso(req, res, fornecedorId)) return;

      if (!req.file) {
        return res.status(400).json({ error: 'Arquivo não enviado ou tipo não permitido (PDF/imagem)' });
      }

      const { tipo = 'outros' } = req.body;
      const tiposValidos = ['cartao_cnpj', 'proposta_comercial', 'contrato', 'outros'];
      if (!tiposValidos.includes(tipo)) {
        return res.status(400).json({ error: `tipo inválido. Use: ${tiposValidos.join(', ')}` });
      }

      // Calcula hash SHA-256
      const fileBuffer = await readFile(req.file.path);
      const hash = createHash('sha256').update(fileBuffer).digest('hex');

      const { subirArquivo } = await import('../services/storage-service.js');
      const forn = await queryOne('SELECT razao_social FROM fornecedores WHERE id=$1', [fornecedorId]);
      const upRes = await subirArquivo(req.file.path, req.file.originalname, req.file.mimetype, {
        envioId: null,
        protocolo: `FORN-${fornecedorId}`,
        fornecedor: forn?.razao_social,
        competencia: 'docs-fixos',
      });

      // Persiste no banco
      const { rows: [doc] } = await query(
        `INSERT INTO fornecedor_documentos_fixos
           (fornecedor_id, tipo, nome_original, mime_type, tamanho_bytes, caminho, hash_sha256, uploaded_por_id, status_validade)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendente')
         RETURNING *`,
        [
          fornecedorId,
          tipo,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          upRes.caminho,
          hash,
          req.usuario.id,
        ]
      );

      // Dispara validação assíncrona em background
      try {
        const { dispararValidacaoBackground, obterCertidaoConfig } = await import('../services/validacao-documentos-service.js');
        const cfg = await obterCertidaoConfig();
        if (cfg.validacao_ativa !== false) {
          dispararValidacaoBackground(doc.id, { tabela: 'fornecedor_documentos_fixos' });
        }
      } catch {}

      res.status(201).json({
        documento: {
          id: doc.id,
          tipo: doc.tipo,
          nome_original: doc.nome_original,
          tamanho_bytes: doc.tamanho_bytes,
          status_validade: doc.status_validade,
          criado_em: doc.criado_em,
        },
      });
    } catch (e) {
      console.error('[fornecedor-docs-fixos/upload]', e);
      res.status(500).json({ error: 'Erro no upload do documento fixo' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/fornecedores/:id/documentos-fixos
// Lista documentos fixos ativos
// ---------------------------------------------------------------------------
router.get('/:id/documentos-fixos', requireAuth, async (req, res) => {
  try {
    const fornecedorId = Number(req.params.id);
    if (!await verificarAcesso(req, res, fornecedorId)) return;

    const { rows } = await query(
      `SELECT id, tipo, nome_original, mime_type, tamanho_bytes, criado_em,
              status_validade, data_expiracao
       FROM fornecedor_documentos_fixos
       WHERE fornecedor_id = $1 AND ativo = TRUE
       ORDER BY tipo, criado_em DESC`,
      [fornecedorId]
    );

    res.json({ documentos: rows });
  } catch (e) {
    console.error('[fornecedor-docs-fixos/listar]', e);
    res.status(500).json({ error: 'Erro ao listar documentos fixos' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/fornecedores/:id/documentos-fixos/:docId
// Soft-delete (ativo = false)
// ---------------------------------------------------------------------------
router.delete('/:id/documentos-fixos/:docId', requireAuth, async (req, res) => {
  try {
    const fornecedorId = Number(req.params.id);
    const docId = Number(req.params.docId);
    if (!await verificarAcesso(req, res, fornecedorId)) return;

    const doc = await queryOne(
      `SELECT id FROM fornecedor_documentos_fixos WHERE id = $1 AND fornecedor_id = $2 AND ativo = TRUE`,
      [docId, fornecedorId]
    );
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });

    await query(
      `UPDATE fornecedor_documentos_fixos SET ativo = FALSE WHERE id = $1`,
      [docId]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[fornecedor-docs-fixos/deletar]', e);
    res.status(500).json({ error: 'Erro ao remover documento fixo' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/fornecedores/:id/documentos-fixos/:docId/download
// Serve o arquivo para download
// ---------------------------------------------------------------------------
router.get('/:id/documentos-fixos/:docId/download', requireAuth, async (req, res) => {
  try {
    const fornecedorId = Number(req.params.id);
    const docId = Number(req.params.docId);
    if (!await verificarAcesso(req, res, fornecedorId)) return;

    const doc = await queryOne(
      `SELECT nome_original, mime_type, caminho
       FROM fornecedor_documentos_fixos
       WHERE id = $1 AND fornecedor_id = $2 AND ativo = TRUE`,
      [docId, fornecedorId]
    );
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });

    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.nome_original)}"`);

    if (doc.caminho.includes('://')) {
      const { obterBuffer } = await import('../services/storage-service.js');
      const buf = await obterBuffer(doc.caminho);
      return res.send(buf);
    }

    try {
      await access(doc.caminho);
    } catch {
      return res.status(410).json({ error: 'Arquivo não disponível no servidor' });
    }

    const buf = await readFile(doc.caminho);
    res.send(buf);
  } catch (e) {
    console.error('[fornecedor-docs-fixos/download]', e);
    res.status(500).json({ error: 'Erro ao baixar documento fixo' });
  }
});

export default router;
