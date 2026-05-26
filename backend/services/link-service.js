// =====================================================================
// Link Service: cria, busca, revoga links publicos
// =====================================================================
import { nanoid } from 'nanoid';
import { query, queryOne } from '../db/index.js';

/**
 * Cria link publico para um fornecedor/unidade/modalidade.
 * Apenas operador_unidade ou admin_fesf.
 */
export async function criarLinkPublico({ usuarioId, fornecedorId, unidadeId, modalidadeId, emailDestinatario, expiraEm, usoMultiplo, usosMax, expectativaId }) {
  const usr = await queryOne('SELECT * FROM usuarios WHERE id=$1', [usuarioId]);
  if (!usr) { const e = new Error('Usuario nao encontrado'); e.code='NO_USER'; throw e; }
  if (usr.papel !== 'operador_unidade' && usr.papel !== 'admin_fesf') {
    const e = new Error('Apenas operadores podem gerar links'); e.code = 'FORBIDDEN'; throw e;
  }
  if (usr.papel === 'operador_unidade' && usr.unidade_id !== unidadeId) {
    const e = new Error('Operador nao pertence a esta unidade'); e.code = 'WRONG_UNIT'; throw e;
  }

  // V227/O6: usos_max valida com uso_multiplo. Se N>1, força uso_multiplo=true.
  let usosMaxClean = null;
  if (usosMax != null && usosMax !== '') {
    const n = Number(usosMax);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      const e = new Error('usos_max deve ser inteiro entre 1 e 1000'); e.code = 'INVALID'; throw e;
    }
    usosMaxClean = n;
    if (n > 1) usoMultiplo = true; // implícito
  }

  // V227/O6: expira_em obrigatório quando uso_multiplo=true (segurança — link
  // multi-uso sem prazo é alvo de vazamento perpétuo).
  if (usoMultiplo && !expiraEm) {
    const e = new Error('Link multi-uso requer data de expiracao'); e.code = 'INVALID'; throw e;
  }

  const token = `pub_${nanoid(24)}`;

  const { rows: [link] } = await query(
    `INSERT INTO links_publicos (token, fornecedor_id, unidade_id, modalidade_id,
                                  email_destinatario, expira_em, uso_multiplo, usos_max, expectativa_id, criado_por_usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [token, fornecedorId || null, unidadeId, modalidadeId, emailDestinatario || null, expiraEm || null, !!usoMultiplo, usosMaxClean, expectativaId || null, usuarioId]
  );

  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
     VALUES ('link_publico', $1, 'criado', $2, $3)`,
    [link.id, usuarioId, `token=${token} unidade=${unidadeId} usos_max=${usosMaxClean || '∞'} expira=${expiraEm || 'nunca'}`]
  );

  return link;
}

/**
 * Resolve um token e retorna contexto (sem expor dados sensíveis).
 */
export async function lookupToken(token) {
  const row = await queryOne(
    `SELECT lp.token, lp.expira_em, lp.revogado, lp.uso_multiplo, lp.usos, lp.usos_max,
            f.id AS fornecedor_id, f.razao_social, f.documento AS fornecedor_documento, f.tipo AS fornecedor_tipo,
            u.id AS unidade_id, u.sigla AS unidade_sigla, u.nome AS unidade_nome,
            m.id AS modalidade_id, m.codigo AS modalidade_codigo, m.nome AS modalidade_nome, m.formulario
     FROM links_publicos lp
     JOIN unidades u ON u.id = lp.unidade_id
     JOIN modalidades m ON m.id = lp.modalidade_id
     LEFT JOIN fornecedores f ON f.id = lp.fornecedor_id
     WHERE lp.token = $1`,
    [token]
  );
  if (!row) return null;
  // valido?
  let valido = !row.revogado;
  let motivoInvalido = null;
  if (row.revogado) motivoInvalido = 'revogado';
  if (row.expira_em && new Date(row.expira_em) < new Date()) { valido = false; motivoInvalido = 'expirado'; }
  if (!row.uso_multiplo && row.usos > 0)                      { valido = false; motivoInvalido = 'ja_utilizado'; }
  // V227/O6: respeita usos_max quando definido (mesmo que uso_multiplo=true)
  if (row.usos_max != null && row.usos >= row.usos_max)        { valido = false; motivoInvalido = 'usos_esgotados'; }
  return { ...row, valido, motivoInvalido };
}

/**
 * Lista links de uma unidade.
 */
export async function listarLinksUnidade(unidadeId) {
  const { rows } = await query(
    `SELECT lp.id, lp.token, lp.email_destinatario, lp.criado_em, lp.expira_em,
            lp.uso_multiplo, lp.usos, lp.usos_max, lp.revogado,
            f.razao_social AS fornecedor_razao_social, f.documento AS fornecedor_documento,
            m.nome AS modalidade_nome
     FROM links_publicos lp
     LEFT JOIN fornecedores f ON f.id = lp.fornecedor_id
     JOIN modalidades m ON m.id = lp.modalidade_id
     WHERE lp.unidade_id = $1
     ORDER BY lp.criado_em DESC`,
    [unidadeId]
  );
  return rows;
}

/**
 * Revoga link.
 */
export async function revogarLink(linkId, usuarioId) {
  await query('UPDATE links_publicos SET revogado=TRUE WHERE id=$1', [linkId]);
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id)
     VALUES ('link_publico', $1, 'revogado', $2)`,
    [linkId, usuarioId]
  );
}
