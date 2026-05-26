// =====================================================================
// Service: captura de erros do cliente (V291)
// Recebe erros JS/network do browser, faz dedup por hash, persiste para admin diagnosticar.
// =====================================================================
import { query, queryOne } from '../db/index.js';
import crypto from 'crypto';

// Computa hash de dedup baseado em campos estáveis do erro
function hashErro({ tipo, mensagem, url, stack }) {
  const stackTop = (stack || '').split('\n').slice(0, 3).join('\n');
  const seed = `${tipo}|${mensagem}|${url}|${stackTop}`;
  return crypto.createHash('sha1').update(seed).digest('hex').substring(0, 16);
}

// Valida payload — limita tamanhos para evitar abuso
function sanitizar(payload) {
  const clip = (s, n) => (typeof s === 'string' ? s.substring(0, n) : null);
  return {
    tipo: clip(payload.tipo, 32) || 'runtime',
    mensagem: clip(payload.mensagem, 500) || '(sem mensagem)',
    url: clip(payload.url, 500) || '',
    user_agent: clip(payload.user_agent, 300),
    stack: clip(payload.stack, 4000),
    request_method: clip(payload.request_method, 10),
    request_url: clip(payload.request_url, 500),
    http_status: typeof payload.http_status === 'number' ? payload.http_status : null,
  };
}

const TIPOS_VALIDOS = new Set(['runtime', 'unhandled-rejection', 'fetch-fail', 'console-error', 'http-error']);

export async function registrarErroCliente(payload, usuario) {
  const s = sanitizar(payload || {});
  if (!TIPOS_VALIDOS.has(s.tipo)) {
    const err = new Error('Tipo inválido'); err.code = 'INVALID_TIPO'; throw err;
  }
  if (!s.mensagem || !s.url) {
    const err = new Error('Mensagem e URL obrigatórios'); err.code = 'INVALID_PAYLOAD'; throw err;
  }
  const hash = hashErro(s);
  // Dedup: se já existe não-resolvido com mesmo hash, incrementa contador
  const existente = await queryOne(
    `SELECT id, ocorrencias FROM client_errors WHERE dedup_hash=$1 AND resolvido=FALSE`,
    [hash]
  );
  if (existente) {
    await query(
      `UPDATE client_errors SET ocorrencias = ocorrencias + 1, ultima_ocorrencia = NOW() WHERE id=$1`,
      [existente.id]
    );
    return { id: existente.id, dedup: true, ocorrencias: existente.ocorrencias + 1 };
  }
  const r = await queryOne(
    `INSERT INTO client_errors (
       usuario_id, papel, url, user_agent, tipo, mensagem, stack,
       request_method, request_url, http_status, dedup_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      usuario?.id || null,
      usuario?.papel || null,
      s.url, s.user_agent, s.tipo, s.mensagem, s.stack,
      s.request_method, s.request_url, s.http_status, hash,
    ]
  );
  return { id: r.id, dedup: false, ocorrencias: 1 };
}

export async function listarErrosCliente({ resolvido, tipo, limit = 100, offset = 0 } = {}) {
  const conds = [];
  const vals = [];
  if (typeof resolvido === 'boolean') { conds.push(`resolvido = $${vals.length + 1}`); vals.push(resolvido); }
  if (tipo) { conds.push(`tipo = $${vals.length + 1}`); vals.push(tipo); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const { rows: erros } = await query(
    `SELECT ce.*, u.nome AS usuario_nome
     FROM client_errors ce
     LEFT JOIN usuarios u ON u.id = ce.usuario_id
     ${where}
     ORDER BY ce.ultima_ocorrencia DESC
     LIMIT ${lim} OFFSET ${off}`,
    vals
  );
  const totalRow = await queryOne(`SELECT COUNT(*)::int AS n FROM client_errors ${where}`, vals);
  return { erros, total: totalRow?.n || 0 };
}

export async function resolverErroCliente(id, usuarioId) {
  await query(
    `UPDATE client_errors SET resolvido=TRUE, resolvido_em=NOW(), resolvido_por_id=$1 WHERE id=$2`,
    [usuarioId, id]
  );
  return { id, resolvido: true };
}

export async function estatisticasErros() {
  const { rows } = await query(
    `SELECT tipo, COUNT(*)::int AS n, SUM(ocorrencias)::int AS total
     FROM client_errors WHERE resolvido = FALSE GROUP BY tipo`
  );
  const total = rows.reduce((a, r) => a + Number(r.total || 0), 0);
  return { por_tipo: rows, total_nao_resolvidos: total };
}
