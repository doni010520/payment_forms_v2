// =====================================================================
// Unidade Service: CRUD + estatisticas
// =====================================================================
import { query, queryOne } from '../db/index.js';

export async function criarUnidade({ sigla, nome, cidade, estado = 'BA' }) {
  if (!sigla || sigla.trim().length < 2) {
    const e = new Error('sigla obrigatoria (>=2 chars)'); e.code = 'INVALID_SIGLA'; throw e;
  }
  if (!nome || nome.trim().length < 3) {
    const e = new Error('nome obrigatorio (>=3 chars)'); e.code = 'INVALID_NAME'; throw e;
  }
  if (!cidade || cidade.trim().length < 2) {
    const e = new Error('cidade obrigatoria'); e.code = 'INVALID_CIDADE'; throw e;
  }
  const existe = await queryOne('SELECT id FROM unidades WHERE sigla=$1', [sigla.trim().toUpperCase()]);
  if (existe) { const e = new Error('sigla ja em uso'); e.code = 'DUPLICATED'; throw e; }
  const { rows: [u] } = await query(
    `INSERT INTO unidades (sigla, nome, cidade, estado, ativa) VALUES ($1,$2,$3,$4,TRUE) RETURNING *`,
    [sigla.trim().toUpperCase(), nome.trim(), cidade.trim(), estado.trim().toUpperCase()]
  );
  return u;
}

export async function atualizarUnidade(id, { nome, cidade, estado }) {
  const u = await queryOne('SELECT * FROM unidades WHERE id=$1', [id]);
  if (!u) { const e = new Error('nao encontrada'); e.code = 'NOT_FOUND'; throw e; }
  const novoNome = nome?.trim() || u.nome;
  const novaCidade = cidade?.trim() || u.cidade;
  const novoEstado = estado?.trim()?.toUpperCase() || u.estado;
  await query(`UPDATE unidades SET nome=$1, cidade=$2, estado=$3 WHERE id=$4`, [novoNome, novaCidade, novoEstado, id]);
  return { id, nome: novoNome, cidade: novaCidade, estado: novoEstado };
}

export async function alternarAtivaUnidade(id, ativa) {
  const u = await queryOne('SELECT * FROM unidades WHERE id=$1', [id]);
  if (!u) { const e = new Error('nao encontrada'); e.code = 'NOT_FOUND'; throw e; }
  await query(`UPDATE unidades SET ativa=$1 WHERE id=$2`, [!!ativa, id]);
  return { id, ativa: !!ativa };
}

/**
 * Atividade recente da unidade — trilha de auditoria com nomes legiveis.
 */
export async function atividadeRecenteUnidade(unidadeId, limit = 15) {
  const { rows } = await query(
    `SELECT a.id, a.acao, a.detalhe, a.criado_em,
            u.nome AS usuario_nome, u.papel AS usuario_papel,
            e.protocolo, e.id AS envio_id
     FROM auditoria a
     LEFT JOIN usuarios u ON u.id = a.usuario_id
     LEFT JOIN envios e ON e.id = a.entidade_id AND a.entidade = 'envio'
     WHERE
       (a.entidade = 'envio' AND e.unidade_id = $1)
       OR (a.entidade = 'expectativa' AND a.entidade_id IN (SELECT id FROM expectativas WHERE unidade_id = $1))
     ORDER BY a.criado_em DESC
     LIMIT $2`,
    [unidadeId, limit]
  );
  return rows;
}

/**
 * Serie temporal de envios (ultimas N semanas) para grafico de barras.
 */
export async function serieTemporal(unidadeId, semanas = 4) {
  // Agrupa por semana — Postgres EXTRACT(WEEK FROM criado_em)
  const { rows } = await query(
    `SELECT
       DATE_TRUNC('week', criado_em)::date AS semana,
       COUNT(*)::int AS total,
       SUM(CASE WHEN status='em_analise' THEN 1 ELSE 0 END)::int AS em_analise,
       SUM(CASE WHEN status='aguardando_ret' THEN 1 ELSE 0 END)::int AS aguardando_ret,
       SUM(CASE WHEN status IN ('aprovado','pago') THEN 1 ELSE 0 END)::int AS aprovados,
       SUM(CASE WHEN status='rejeitado' THEN 1 ELSE 0 END)::int AS rejeitados
     FROM envios
     WHERE unidade_id = $1
       AND criado_em >= NOW() - INTERVAL '${Math.min(Number(semanas) || 4, 26)} weeks'
     GROUP BY 1 ORDER BY 1`,
    [unidadeId]
  );
  return rows;
}

/**
 * Detalhe completo da unidade: dados, KPIs, ultimos envios, expectativas.
 */
export async function detalheUnidade(id) {
  const unidade = await queryOne('SELECT * FROM unidades WHERE id=$1', [id]);
  if (!unidade) { const e = new Error('nao encontrada'); e.code = 'NOT_FOUND'; throw e; }

  const totais = await queryOne(
    `SELECT
      COUNT(*)::int AS total_envios,
      COALESCE(SUM(valor_centavos),0)::bigint AS total_centavos,
      SUM(CASE WHEN status='em_analise' THEN 1 ELSE 0 END)::int AS em_analise,
      SUM(CASE WHEN status='aguardando_ret' THEN 1 ELSE 0 END)::int AS aguardando_ret,
      SUM(CASE WHEN status='aprovado' THEN 1 ELSE 0 END)::int AS aprovados,
      SUM(CASE WHEN status='pago' THEN 1 ELSE 0 END)::int AS pagos,
      SUM(CASE WHEN status='rejeitado' THEN 1 ELSE 0 END)::int AS rejeitados
     FROM envios WHERE unidade_id=$1`, [id]
  );

  const porOrigem = (await query(
    `SELECT origem, COUNT(*)::int AS n, COALESCE(SUM(valor_centavos),0)::bigint AS total_centavos
     FROM envios WHERE unidade_id=$1 GROUP BY origem ORDER BY origem`, [id]
  )).rows;

  const ultimos = (await query(
    `SELECT e.id, e.protocolo, e.competencia, e.origem, e.status, e.valor_centavos, e.criado_em,
            f.razao_social, m.nome AS modalidade_nome
     FROM envios e JOIN fornecedores f ON f.id=e.fornecedor_id JOIN modalidades m ON m.id=e.modalidade_id
     WHERE e.unidade_id=$1 ORDER BY e.criado_em DESC LIMIT 10`, [id]
  )).rows;

  const expectativas = (await query(
    `SELECT status, COUNT(*)::int AS n FROM expectativas WHERE unidade_id=$1 GROUP BY status`, [id]
  )).rows;

  const operadores = (await query(
    `SELECT id, nome, email, ativo, ultimo_login FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1 ORDER BY nome`, [id]
  )).rows;

  const fornecedores_count = (await queryOne(
    `SELECT COUNT(DISTINCT f.id)::int AS n FROM fornecedores f
     JOIN fornecedor_unidades fu ON fu.fornecedor_id = f.id
     WHERE fu.unidade_id=$1 AND f.ativo=TRUE`, [id]
  )).n;

  return { unidade, totais, por_origem: porOrigem, ultimos_envios: ultimos, expectativas, operadores, fornecedores_count };
}
