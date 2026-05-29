// =====================================================================
// Expectativa Service: cria, lembra, escalona pendencias
// =====================================================================
import { query, queryOne } from '../db/index.js';
import { notificarFornecedor, notificarOperadoresUnidade } from './notificacao-service.js';

const CADENCIA_PADRAO = {
  primeiroLembreteDiasAntes: 5,
  segundoLembreteDiasAntes: 1,
  semRespostaDiasApos: 3,
  atrasadaDiasApos: 7,
};

/**
 * V232/O4: simula a cadência de lembretes para uma expectativa hipotética.
 * Recebe prazo (ISO date) + cadência opcional `{antes:[N],depois:[N]}` ou usa padrão.
 * Retorna [{ quando, label, tipo }] ordenado cronologicamente.
 */
export function previewCadencia({ prazo, cadencia = null }) {
  if (!prazo) throw Object.assign(new Error('prazo obrigatorio'), { code: 'INVALID' });
  const prazoDate = new Date(prazo);
  if (isNaN(prazoDate.getTime())) throw Object.assign(new Error('prazo invalido'), { code: 'INVALID' });
  // Normaliza para meia-noite UTC para evitar drift
  prazoDate.setUTCHours(0, 0, 0, 0);
  const antes = (cadencia?.antes && Array.isArray(cadencia.antes))
    ? cadencia.antes.map(Number).filter(n => Number.isFinite(n) && n >= 0)
    : [CADENCIA_PADRAO.primeiroLembreteDiasAntes, CADENCIA_PADRAO.segundoLembreteDiasAntes];
  const depois = (cadencia?.depois && Array.isArray(cadencia.depois))
    ? cadencia.depois.map(Number).filter(n => Number.isFinite(n) && n >= 0)
    : [CADENCIA_PADRAO.semRespostaDiasApos, CADENCIA_PADRAO.atrasadaDiasApos];
  const eventos = [];
  // Lembretes antes do prazo
  for (const dias of antes) {
    const d = new Date(prazoDate);
    d.setUTCDate(d.getUTCDate() - dias);
    eventos.push({
      quando: d.toISOString().slice(0, 10),
      tipo: 'lembrete',
      label: `Lembrete ${dias}d antes do prazo`,
    });
  }
  // Prazo (marco)
  eventos.push({
    quando: prazoDate.toISOString().slice(0, 10),
    tipo: 'prazo',
    label: 'Prazo de envio (vencimento)',
  });
  // Escalonamentos depois do prazo
  for (let i = 0; i < depois.length; i++) {
    const dias = depois[i];
    const d = new Date(prazoDate);
    d.setUTCDate(d.getUTCDate() + dias);
    eventos.push({
      quando: d.toISOString().slice(0, 10),
      tipo: i === 0 ? 'sem_resposta' : 'atrasada',
      label: i === 0
        ? `Marcado "sem resposta" (${dias}d após prazo)`
        : `Marcado "atrasada" (${dias}d após prazo)`,
    });
  }
  // Ordena por data
  eventos.sort((a, b) => a.quando.localeCompare(b.quando));
  return eventos;
}

/**
 * V232/O4: agregado de métricas sobre expectativas.
 * Operador: filtra para a unidade dele. Admin: sistema-wide ou unidade específica.
 */
export async function metricasExpectativas({ unidadeId = null } = {}) {
  const params = [];
  let where = '1=1';
  if (unidadeId) { where += ` AND unidade_id = $${params.length + 1}`; params.push(unidadeId); }
  // Totais por status
  const { rows: porStatus } = await query(
    `SELECT status, COUNT(*)::int AS n FROM expectativas WHERE ${where} GROUP BY status ORDER BY status`,
    params
  );
  // V232/O4: tempo médio em dias até cumprimento. Não há coluna cumprida_em;
  // usamos envios.criado_em quando há vínculo. atualizada_em é fallback.
  const whereTempo = unidadeId ? `e.unidade_id = $1 AND e.status='cumprida'` : `e.status='cumprida'`;
  const paramsTempo = unidadeId ? [unidadeId] : [];
  const { rows: [tempo] } = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (COALESCE(env.criado_em, e.atualizada_em) - e.criada_em)) / 86400)::float AS dias_medio_cumprimento,
            COUNT(*)::int AS total_cumpridas
     FROM expectativas e
     LEFT JOIN envios env ON env.id = e.envio_id
     WHERE ${whereTempo}`,
    paramsTempo
  );
  // Distribuição por unidade (admin sem filtro)
  let porUnidade = [];
  if (!unidadeId) {
    const r = await query(
      `SELECT un.sigla, un.nome, COUNT(e.id)::int AS total,
              SUM(CASE WHEN e.status='atrasada' THEN 1 ELSE 0 END)::int AS atrasadas,
              SUM(CASE WHEN e.status='aguardando' THEN 1 ELSE 0 END)::int AS aguardando
       FROM unidades un
       LEFT JOIN expectativas e ON e.unidade_id = un.id
       WHERE un.ativa = TRUE
       GROUP BY un.id, un.sigla, un.nome
       ORDER BY atrasadas DESC, total DESC`
    );
    porUnidade = r.rows;
  }
  return {
    por_status: porStatus,
    dias_medio_cumprimento: tempo.dias_medio_cumprimento ? Number(tempo.dias_medio_cumprimento.toFixed(2)) : null,
    total_cumpridas: tempo.total_cumpridas || 0,
    por_unidade: porUnidade,
  };
}

/**
 * Cria expectativa de envio (cenario 3 inicia aqui).
 */
export async function criarExpectativa({ usuarioId, fornecedorId, unidadeId, modalidadeId, competencia, prazo, origemPrevista, observacoes, cadencia, forcarInadimplente = false }) {
  if (!['portal', 'link_publico', 'manual'].includes(origemPrevista)) {
    const e = new Error('origem_prevista invalida'); e.code = 'INVALID_ORIGEM'; throw e;
  }
  // Alerta de inadimplencia: se o fornecedor esta marcado como inadimplente, exige confirmacao explicita
  const forn = await queryOne('SELECT status_engajamento, motivo_engajamento, razao_social FROM fornecedores WHERE id=$1', [fornecedorId]);
  if (forn && forn.status_engajamento === 'inadimplente' && !forcarInadimplente) {
    const e = new Error(`Fornecedor "${forn.razao_social}" está marcado como INADIMPLENTE${forn.motivo_engajamento ? ': ' + forn.motivo_engajamento : ''}. Reenvie com forcar_inadimplente=true para confirmar.`);
    e.code = 'FORNECEDOR_INADIMPLENTE';
    throw e;
  }
  // Valida cadencia se fornecida: { antes: [num], depois: [num] }
  let cadenciaJson = null;
  if (cadencia) {
    if (typeof cadencia !== 'object' || (cadencia.antes && !Array.isArray(cadencia.antes)) || (cadencia.depois && !Array.isArray(cadencia.depois))) {
      const e = new Error('cadencia invalida (esperado {antes:[],depois:[]})'); e.code = 'INVALID_CADENCIA'; throw e;
    }
    cadenciaJson = JSON.stringify({
      antes: (cadencia.antes || []).map(n => Number(n)).filter(n => !Number.isNaN(n) && n >= 0),
      depois: (cadencia.depois || []).map(n => Number(n)).filter(n => !Number.isNaN(n) && n >= 0),
    });
  }
  const { rows: [exp] } = await query(
    `INSERT INTO expectativas (fornecedor_id, unidade_id, modalidade_id, competencia, prazo,
                                origem_prevista, cadencia_json, status, observacoes, criada_por_usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'aguardando', $8, $9) RETURNING *`,
    [fornecedorId, unidadeId, modalidadeId, competencia, prazo, origemPrevista, cadenciaJson, observacoes || null, usuarioId]
  );
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
     VALUES ('expectativa', $1, 'criada', $2, $3)`,
    [exp.id, usuarioId, `prazo=${prazo} origem_prevista=${origemPrevista}${cadenciaJson ? ' cadencia=' + cadenciaJson : ''}`]
  );
  return exp;
}

/**
 * Registra envio de lembrete e atualiza status da expectativa para 'lembrado'.
 */
export async function enviarLembrete({ expectativaId, canal = 'email', usuarioId = null, conteudo = null }) {
  const exp = await queryOne('SELECT * FROM expectativas WHERE id=$1', [expectativaId]);
  if (!exp) { const e = new Error('Expectativa nao encontrada'); e.code='NOT_FOUND'; throw e; }

  // qual numero de lembrete e este?
  const { rows: [{ n }] } = await query('SELECT COUNT(*)::int AS n FROM lembretes WHERE expectativa_id=$1', [expectativaId]);
  const numero = n + 1;

  await query(
    `INSERT INTO lembretes (expectativa_id, numero, canal, enviado_por_usuario_id, conteudo)
     VALUES ($1, $2, $3, $4, $5)`,
    [expectativaId, numero, canal, usuarioId, conteudo]
  );

  // atualiza status apenas se ainda esta 'aguardando'
  if (exp.status === 'aguardando') {
    await query(`UPDATE expectativas SET status='lembrado', atualizada_em=CURRENT_TIMESTAMP WHERE id=$1`, [expectativaId]);
  }

  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
     VALUES ('expectativa', $1, 'lembrete_enviado', $2, $3)`,
    [expectativaId, usuarioId, `numero=${numero} canal=${canal}`]
  );

  // notifica fornecedor (in-app), alem do canal externo simulado
  await notificarFornecedor({
    fornecedorId: exp.fornecedor_id,
    tipo: 'lembrete_enviado',
    mensagem: `Lembrete #${numero}: voce tem documentacao pendente para envio (prazo ${exp.prazo})`,
    link: '/app/portal.html',
    entidade: 'expectativa', entidadeId: expectativaId,
  });

  return { numero };
}

/**
 * Roda a regra de escalonamento: para cada expectativa nao-cumprida cujo prazo passou,
 * promove para 'sem_resposta' ou 'atrasada' conforme cadencia.
 * Pode ser chamada via cron diario.
 */
export async function executarEscalonamento({ hoje = new Date() } = {}) {
  // formato YYYY-MM-DD do PG
  const hojeISO = hoje.toISOString().slice(0, 10);

  // 1) Promove para 'sem_resposta' (prazo + N dias passou)
  const resSemResp = await query(
    `UPDATE expectativas
     SET status='sem_resposta', atualizada_em=CURRENT_TIMESTAMP
     WHERE status IN ('aguardando','lembrado')
       AND prazo < ($1::date - INTERVAL '${CADENCIA_PADRAO.semRespostaDiasApos} days')
       AND prazo >= ($1::date - INTERVAL '${CADENCIA_PADRAO.atrasadaDiasApos} days')
     RETURNING id, unidade_id, fornecedor_id`,
    [hojeISO]
  );
  // 2) Promove para 'atrasada'
  const resAtras = await query(
    `UPDATE expectativas
     SET status='atrasada', atualizada_em=CURRENT_TIMESTAMP
     WHERE status IN ('aguardando','lembrado','sem_resposta')
       AND prazo < ($1::date - INTERVAL '${CADENCIA_PADRAO.atrasadaDiasApos} days')
     RETURNING id, unidade_id, fornecedor_id`,
    [hojeISO]
  );

  // Notifica operadores das unidades afetadas
  for (const r of resSemResp.rows) {
    await notificarOperadoresUnidade({
      unidadeId: r.unidade_id,
      tipo: 'pendencia_sem_resposta',
      mensagem: `Expectativa #${r.id} virou SEM RESPOSTA — fornecedor nao reagiu`,
      link: '/app/painel.html',
      entidade: 'expectativa', entidadeId: r.id,
    });
  }
  for (const r of resAtras.rows) {
    await notificarOperadoresUnidade({
      unidadeId: r.unidade_id,
      tipo: 'pendencia_atrasada',
      mensagem: `Expectativa #${r.id} virou ATRASADA — acao obrigatoria`,
      link: '/app/painel.html',
      entidade: 'expectativa', entidadeId: r.id,
    });
  }

  return {
    promovidasSemResposta: resSemResp.rows.length,
    promovidasAtrasada: resAtras.rows.length,
  };
}

/**
 * Cancela expectativa com justificativa.
 */
export async function cancelarExpectativa({ expectativaId, usuarioId, motivo }) {
  if (!motivo || motivo.trim().length < 5) {
    const e = new Error('Motivo de cancelamento obrigatorio (>=5 chars)'); e.code = 'MOTIVO_INVALID'; throw e;
  }
  await query(
    `UPDATE expectativas SET status='cancelada', motivo_cancelamento=$1, atualizada_em=CURRENT_TIMESTAMP WHERE id=$2`,
    [motivo, expectativaId]
  );
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
     VALUES ('expectativa', $1, 'cancelada', $2, $3)`,
    [expectativaId, usuarioId, motivo.substring(0, 200)]
  );
}

/**
 * Lista expectativas de uma unidade com filtros.
 */
export async function listarExpectativasUnidade(unidadeId, { status = null, competencia = null } = {}) {
  // V225: unidadeId=null permitido (admin sem filtro vê todas)
  const where = ['1=1'];
  const params = [];
  if (unidadeId)   { where.push(`e.unidade_id = $${params.length + 1}`); params.push(unidadeId); }
  if (status)      { where.push(`e.status = $${params.length + 1}`); params.push(status); }
  if (competencia) { where.push(`e.competencia = $${params.length + 1}`); params.push(competencia); }

  const { rows } = await query(
    `SELECT e.*,
            f.razao_social, f.documento, f.tipo AS fornecedor_tipo, f.email AS fornecedor_email,
            m.codigo AS modalidade_codigo, m.nome AS modalidade_nome,
            un.sigla AS unidade_sigla, un.nome AS unidade_nome,
            (SELECT COUNT(*)::int FROM lembretes l WHERE l.expectativa_id = e.id) AS lembretes_enviados
     FROM expectativas e
     LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
     JOIN modalidades m ON m.id = e.modalidade_id
     JOIN unidades un ON un.id = e.unidade_id
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE e.status WHEN 'atrasada' THEN 1 WHEN 'sem_resposta' THEN 2 WHEN 'lembrado' THEN 3 WHEN 'aguardando' THEN 4 ELSE 5 END,
       e.prazo ASC`,
    params
  );
  return rows;
}
