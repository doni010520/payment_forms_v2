// =====================================================================
// Notificacao Service: cria e consulta notificacoes in-app
// =====================================================================
import { query, queryOne } from '../db/index.js';
import { enviarEmail, templates } from './email-service.js';

/**
 * Mapeia tipo de notificação → chave de preferência.
 * Notificações fora deste mapa (ex: 'sistema') sempre passam.
 */
function tipoParaPrefKey(tipo) {
  if (!tipo) return null;
  if (tipo === 'novo_envio') return 'novo_envio';
  if (tipo.includes('aprovad') || tipo.includes('rejeit') || tipo.includes('retific') || tipo.includes('pago')) return 'status_envio';
  if (tipo.includes('coment')) return 'comentarios';
  if (tipo.includes('pago') || tipo.includes('pagamento')) return 'pagamento';
  return null; // sistema, lembrete, etc. — sempre passam
}

/**
 * Cria notificacao para um usuario.
 * Respeita usuarios.notif_prefs — se usuário desabilitou esse tipo, pula.
 */
export async function notificar({ usuarioId, tipo, mensagem, link = null, entidade = null, entidadeId = null }) {
  if (!usuarioId) return null;
  // Checa preferências do usuário
  const usr = await queryOne('SELECT email, nome, notif_prefs FROM usuarios WHERE id=$1', [usuarioId]);
  if (!usr) return null;
  const prefKey = tipoParaPrefKey(tipo);
  if (prefKey && usr.notif_prefs) {
    try {
      const prefs = JSON.parse(usr.notif_prefs);
      if (prefs[prefKey] === false) return null; // usuário desabilitou esse tipo
    } catch {}
  }
  const { rows: [n] } = await query(
    `INSERT INTO notificacoes (usuario_id, tipo, mensagem, link, entidade, entidade_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [usuarioId, tipo, mensagem, link, entidade, entidadeId]
  );
  if (usr.email) {
    await enviarEmail({
      destinatario: usr.email,
      assunto: `[FESF-SUS] ${mensagem.substring(0, 80)}`,
      corpo: `Olá ${usr.nome},\n\n${mensagem}\n\n${link ? 'Acesse: https://pagamentos.fesfsus.ba.gov.br' + link + '\n\n' : ''}Atenciosamente,\nFESF-SUS · Portal de Pagamentos`,
      tipo, entidade, entidadeId,
    });
  }
  return n;
}

/**
 * Notifica todos os operadores de uma unidade.
 */
export async function notificarOperadoresUnidade({ unidadeId, tipo, mensagem, link, entidade, entidadeId }) {
  const { rows: ops } = await query(
    `SELECT id FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1 AND ativo=TRUE`,
    [unidadeId]
  );
  let n = 0;
  for (const o of ops) {
    await notificar({ usuarioId: o.id, tipo, mensagem, link, entidade, entidadeId });
    n++;
  }
  return n;
}

/**
 * Notifica admins FESF.
 */
export async function notificarAdmins({ tipo, mensagem, link, entidade, entidadeId }) {
  const { rows: admins } = await query(`SELECT id FROM usuarios WHERE papel='admin_fesf' AND ativo=TRUE`);
  let n = 0;
  for (const a of admins) {
    await notificar({ usuarioId: a.id, tipo, mensagem, link, entidade, entidadeId });
    n++;
  }
  return n;
}

/**
 * Notifica o(s) usuario(s) do fornecedor.
 */
export async function notificarFornecedor({ fornecedorId, tipo, mensagem, link, entidade, entidadeId }) {
  const { rows } = await query(
    `SELECT id FROM usuarios WHERE papel='fornecedor' AND fornecedor_id=$1 AND ativo=TRUE`,
    [fornecedorId]
  );
  let n = 0;
  for (const u of rows) {
    await notificar({ usuarioId: u.id, tipo, mensagem, link, entidade, entidadeId });
    n++;
  }
  return n;
}

/**
 * Lista notificacoes de um usuario (paginated).
 * Aceita opcionalmente offset para suportar paginacao via page/per_page.
 * Retorna { rows, total } quando withTotal=true.
 */
export async function listarNotificacoes(usuarioId, { naoLidasApenas = false, limit = 50, offset = 0, withTotal = false } = {}) {
  const where = ['usuario_id = $1'];
  const params = [usuarioId];
  if (naoLidasApenas) where.push('lida = FALSE');
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT id, tipo, mensagem, link, entidade, entidade_id, lida, criada_em
     FROM notificacoes WHERE ${where.join(' AND ')}
     ORDER BY criada_em DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  if (!withTotal) return rows;
  const { rows: [c] } = await query(
    `SELECT COUNT(*)::int AS n FROM notificacoes WHERE ${where.join(' AND ')}`,
    params.slice(0, -2)
  );
  return { rows, total: c.n };
}

/**
 * Conta nao-lidas.
 */
export async function contarNaoLidas(usuarioId) {
  const { rows: [r] } = await query(
    `SELECT COUNT(*)::int AS n FROM notificacoes WHERE usuario_id=$1 AND lida=FALSE`,
    [usuarioId]
  );
  return r.n;
}

/**
 * Marca uma como lida (apenas se pertencer ao usuario).
 */
export async function marcarLida(notificacaoId, usuarioId) {
  await query(
    `UPDATE notificacoes SET lida=TRUE WHERE id=$1 AND usuario_id=$2`,
    [notificacaoId, usuarioId]
  );
}

/**
 * Marca todas como lidas.
 */
export async function marcarTodasLidas(usuarioId) {
  const r = await query(
    `UPDATE notificacoes SET lida=TRUE WHERE usuario_id=$1 AND lida=FALSE`,
    [usuarioId]
  );
  return r.affectedRows || 0;
}
