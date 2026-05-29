// =====================================================================
// Envio Service: cria envios nos 3 cenarios
// =====================================================================
import { query, queryOne } from '../db/index.js';
import { notificarOperadoresUnidade, notificarFornecedor } from './notificacao-service.js';

/**
 * Gera protocolo unico no formato SIGLA-NNNN-NNNN.
 */
async function gerarProtocolo(unidadeId) {
  const u = await queryOne('SELECT sigla FROM unidades WHERE id=$1', [unidadeId]);
  if (!u) throw new Error('Unidade nao encontrada');

  // Sequencial: conta envios+1 dessa unidade
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM envios WHERE unidade_id=$1',
    [unidadeId]
  );
  const seq = (rows[0].n + 1).toString().padStart(4, '0');
  const aleat = Math.floor(1000 + Math.random() * 9000).toString();
  return `${u.sigla}-${seq}-${aleat}`;
}

/**
 * Loga acao na auditoria.
 */
async function logar(entidade, entidadeId, acao, usuarioId, detalhe = null) {
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe)
     VALUES ($1,$2,$3,$4,$5)`,
    [entidade, entidadeId, acao, usuarioId, detalhe]
  );
}

/**
 * Detecta envio duplicado: mesmo fornecedor + numero_nf + competencia,
 * em status NAO rejeitado (rejeitado pode ser ressubmetido).
 * Retorna envio existente ou null. Vazio se numero_nf ausente (sem como deduplicar).
 */
export async function detectarEnvioDuplicado({ fornecedorId, numeroNF, competencia }) {
  if (!fornecedorId || !numeroNF || !competencia) return null;
  return await queryOne(
    `SELECT id, protocolo, status, criado_em, unidade_id, modalidade_id
     FROM envios
     WHERE fornecedor_id=$1 AND numero_nf=$2 AND competencia=$3
       AND status NOT IN ('rejeitado')
     ORDER BY criado_em DESC LIMIT 1`,
    [fornecedorId, numeroNF, competencia]
  );
}

/**
 * Resolve expectativa pendente (se houver) marcando como cumprida.
 */
async function cumprirExpectativa({ fornecedorId, unidadeId, modalidadeId, competencia, envioId }) {
  await query(
    `UPDATE expectativas
     SET status='cumprida', envio_id=$5, atualizada_em=CURRENT_TIMESTAMP
     WHERE fornecedor_id=$1 AND unidade_id=$2 AND modalidade_id=$3 AND competencia=$4
       AND status NOT IN ('cumprida','cancelada')`,
    [fornecedorId, unidadeId, modalidadeId, competencia, envioId]
  );
}

/**
 * Cria envio com origem='portal' (cenario 1: fornecedor logado).
 * usuario.papel deve ser 'fornecedor'.
 */
export async function criarEnvioPortal({ usuarioId, unidadeId, modalidadeId, competencia, valorCentavos, numeroNF, descricao, dados = null, permitirDuplicado = false }) {
  const usr = await queryOne('SELECT * FROM usuarios WHERE id=$1', [usuarioId]);
  if (!usr || usr.papel !== 'fornecedor' || !usr.fornecedor_id) {
    const e = new Error('Apenas fornecedores logados podem usar este fluxo'); e.code = 'FORBIDDEN'; throw e;
  }

  // Valida unidade pertence ao fornecedor
  const vinculo = await queryOne(
    'SELECT 1 FROM fornecedor_unidades WHERE fornecedor_id=$1 AND unidade_id=$2',
    [usr.fornecedor_id, unidadeId]
  );
  if (!vinculo) {
    const e = new Error('Fornecedor nao atende esta unidade'); e.code = 'NOT_LINKED'; throw e;
  }

  // Detecta duplicidade (fornecedor+NF+competencia ja em analise/aprovado/pago)
  if (!permitirDuplicado) {
    const dup = await detectarEnvioDuplicado({ fornecedorId: usr.fornecedor_id, numeroNF, competencia });
    if (dup) {
      const e = new Error(`NF "${numeroNF}" para competencia ${competencia} ja foi submetida (protocolo ${dup.protocolo}, status ${dup.status})`);
      e.code = 'DUPLICATE_NF'; e.envioExistente = dup;
      throw e;
    }
  }

  const protocolo = await gerarProtocolo(unidadeId);
  const { rows: [envio] } = await query(
    `INSERT INTO envios (protocolo, fornecedor_id, unidade_id, modalidade_id, competencia, origem, status,
                         valor_centavos, numero_nf, descricao, submetido_por_usuario_id)
     VALUES ($1, $2, $3, $4, $5, 'portal', 'em_analise', $6, $7, $8, $9)
     RETURNING *`,
    [protocolo, usr.fornecedor_id, unidadeId, modalidadeId, competencia, valorCentavos || 0, numeroNF || null, descricao || null, usuarioId]
  );

  // Cria versao 1 com dados completos do form (se enviado)
  const dadosJson = { valorCentavos, numeroNF, descricao, ...(dados || {}) };
  await query(
    `INSERT INTO versoes_envio (envio_id, numero, dados_json) VALUES ($1, 1, $2)`,
    [envio.id, JSON.stringify(dadosJson)]
  );

  await logar('envio', envio.id, 'criado_portal', usuarioId, `Origem: portal · protocolo ${protocolo}`);
  await cumprirExpectativa({ fornecedorId: usr.fornecedor_id, unidadeId, modalidadeId, competencia, envioId: envio.id });

  // notifica operadores da unidade
  await notificarOperadoresUnidade({
    unidadeId,
    tipo: 'novo_envio',
    mensagem: `Novo envio ${protocolo} recebido via portal`,
    link: `/app/painel.html?envio=${envio.id}`,
    entidade: 'envio', entidadeId: envio.id,
  });

  return envio;
}

/**
 * Cria envio com origem='link_publico' (cenario 2: anonimo via token).
 * Valida o token, verifica expiracao, registra uso.
 */
export async function criarEnvioLinkPublico({ token, dadosSubmetente, valorCentavos, numeroNF, descricao, competencia, dados = null }) {
  const link = await queryOne(
    `SELECT lp.*, f.documento AS forn_doc, f.razao_social
     FROM links_publicos lp
     LEFT JOIN fornecedores f ON f.id = lp.fornecedor_id
     WHERE lp.token = $1`,
    [token]
  );
  if (!link) {
    const e = new Error('Link invalido'); e.code = 'INVALID_TOKEN'; throw e;
  }
  if (link.revogado) {
    const e = new Error('Link revogado'); e.code = 'REVOKED'; throw e;
  }
  if (link.expira_em && new Date(link.expira_em) < new Date()) {
    const e = new Error('Link expirado'); e.code = 'EXPIRED'; throw e;
  }
  if (!link.uso_multiplo && link.usos > 0) {
    const e = new Error('Link de uso unico ja foi utilizado'); e.code = 'ALREADY_USED'; throw e;
  }
  // V227/O6: limite explícito de usos. NULL = ilimitado (mas só se uso_multiplo=TRUE).
  if (link.usos_max != null && link.usos >= link.usos_max) {
    const e = new Error(`Link atingiu o limite de ${link.usos_max} usos`); e.code = 'USOS_ESGOTADOS'; throw e;
  }

  // Detecta duplicidade (so se o link estiver vinculado a um fornecedor)
  if (link.fornecedor_id) {
    const dup = await detectarEnvioDuplicado({ fornecedorId: link.fornecedor_id, numeroNF, competencia });
    if (dup) {
      const e = new Error(`NF "${numeroNF}" para competencia ${competencia} ja foi submetida (protocolo ${dup.protocolo})`);
      e.code = 'DUPLICATE_NF'; e.envioExistente = dup;
      throw e;
    }
  }

  const protocolo = await gerarProtocolo(link.unidade_id);
  const { rows: [envio] } = await query(
    `INSERT INTO envios (protocolo, fornecedor_id, unidade_id, modalidade_id, competencia, origem, status,
                         valor_centavos, numero_nf, descricao,
                         submetido_por_nome, submetido_por_documento, link_publico_id)
     VALUES ($1, $2, $3, $4, $5, 'link_publico', 'em_analise', $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      protocolo,
      link.fornecedor_id,
      link.unidade_id,
      link.modalidade_id,
      competencia,
      valorCentavos || 0,
      numeroNF || null,
      descricao || null,
      dadosSubmetente?.nome || link.razao_social || 'Anonimo',
      dadosSubmetente?.documento || link.forn_doc || null,
      link.id,
    ]
  );

  const dadosJsonPub = { valorCentavos, numeroNF, descricao, dadosSubmetente, ...(dados || {}) };
  await query(
    `INSERT INTO versoes_envio (envio_id, numero, dados_json) VALUES ($1, 1, $2)`,
    [envio.id, JSON.stringify(dadosJsonPub)]
  );

  // Marca uso do link
  await query('UPDATE links_publicos SET usos = usos + 1 WHERE id = $1', [link.id]);

  await logar('envio', envio.id, 'criado_link_publico', null, `Via link ${token} · protocolo ${protocolo}`);
  if (link.fornecedor_id) {
    await cumprirExpectativa({
      fornecedorId: link.fornecedor_id,
      unidadeId: link.unidade_id,
      modalidadeId: link.modalidade_id,
      competencia,
      envioId: envio.id,
    });
  }

  await notificarOperadoresUnidade({
    unidadeId: link.unidade_id,
    tipo: 'novo_envio',
    mensagem: `Novo envio ${protocolo} recebido via link público`,
    link: `/app/painel.html?envio=${envio.id}`,
    entidade: 'envio', entidadeId: envio.id,
  });

  return envio;
}

/**
 * Cria envio com origem='manual' (cenario 3: operador lanca pelo fornecedor).
 * Exige usuario operador_unidade da unidade alvo + motivo nao-vazio.
 */
export async function criarEnvioManual({ usuarioId, fornecedorId, unidadeId, modalidadeId, competencia, valorCentavos, numeroNF, descricao, motivo, expectativaId, permitirDuplicado = false }) {
  // V222/O5: minimo 10 chars para forçar justificativa real (auditoria).
  // Cenario 3 = via de excecao — motivo curto ("ok", "via tel") destruia o
  // valor probatorio do registro.
  if (!motivo || motivo.trim().length < 10) {
    const e = new Error('Motivo do lancamento manual obrigatorio (>=10 chars) — descreva por que foi necessario fazer manualmente'); e.code = 'MOTIVO_INVALID'; throw e;
  }

  const usr = await queryOne('SELECT * FROM usuarios WHERE id=$1', [usuarioId]);
  if (!usr) { const e = new Error('Usuario nao encontrado'); e.code = 'NO_USER'; throw e; }
  if (usr.papel !== 'operador_unidade' && usr.papel !== 'admin_fesf') {
    const e = new Error('Apenas operador da unidade pode lancar manualmente'); e.code = 'FORBIDDEN'; throw e;
  }
  if (usr.papel === 'operador_unidade' && usr.unidade_id !== unidadeId) {
    const e = new Error('Operador nao pertence a esta unidade'); e.code = 'WRONG_UNIT'; throw e;
  }

  const forn = await queryOne('SELECT * FROM fornecedores WHERE id=$1', [fornecedorId]);
  if (!forn) { const e = new Error('Fornecedor nao encontrado'); e.code = 'NO_FORN'; throw e; }

  if (!permitirDuplicado) {
    const dup = await detectarEnvioDuplicado({ fornecedorId, numeroNF, competencia });
    if (dup) {
      const e = new Error(`NF "${numeroNF}" para competencia ${competencia} ja foi submetida (protocolo ${dup.protocolo})`);
      e.code = 'DUPLICATE_NF'; e.envioExistente = dup;
      throw e;
    }
  }

  const protocolo = await gerarProtocolo(unidadeId);
  const { rows: [envio] } = await query(
    `INSERT INTO envios (protocolo, fornecedor_id, unidade_id, modalidade_id, competencia, origem, status,
                         valor_centavos, numero_nf, descricao, submetido_por_usuario_id, motivo_manual,
                         expectativa_id)
     VALUES ($1, $2, $3, $4, $5, 'manual', 'em_analise', $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [protocolo, fornecedorId, unidadeId, modalidadeId, competencia, valorCentavos || 0,
     numeroNF || null, descricao || null, usuarioId, motivo, expectativaId || null]
  );

  await query(
    `INSERT INTO versoes_envio (envio_id, numero, dados_json) VALUES ($1, 1, $2)`,
    [envio.id, JSON.stringify({ valorCentavos, numeroNF, descricao, motivo })]
  );

  await logar('envio', envio.id, 'criado_manual', usuarioId, `Origem: manual · motivo: ${motivo.substring(0, 200)}`);

  if (expectativaId) {
    await query(`UPDATE expectativas SET status='cumprida', envio_id=$1, atualizada_em=CURRENT_TIMESTAMP WHERE id=$2`, [envio.id, expectativaId]);
  } else {
    await cumprirExpectativa({ fornecedorId, unidadeId, modalidadeId, competencia, envioId: envio.id });
  }

  return envio;
}

/**
 * Lista envios de uma unidade com filtros opcionais.
 */
export async function listarEnviosUnidade(unidadeId, { origem = null, status = null, competencia = null, de = null, ate = null, limit = 50, offset = 0 } = {}) {
  const where = ['e.unidade_id = $1'];
  const params = [unidadeId];
  if (origem)      { where.push(`e.origem = $${params.length + 1}`); params.push(origem); }
  if (status)      { where.push(`e.status = $${params.length + 1}`); params.push(status); }
  if (competencia) { where.push(`e.competencia = $${params.length + 1}`); params.push(competencia); }
  if (de)          { where.push(`e.criado_em >= $${params.length + 1}::date`); params.push(de); }
  if (ate)         { where.push(`e.criado_em < ($${params.length + 1}::date + INTERVAL '1 day')`); params.push(ate); }

  const sql = `
    SELECT e.id, e.protocolo, e.competencia, e.origem, e.status, e.valor_centavos, e.numero_nf, e.descricao, e.criado_em,
           e.unidade_id, un.sigla AS unidade_sigla, un.nome AS unidade_nome,
           f.razao_social, f.documento, f.tipo AS fornecedor_tipo,
           m.codigo AS modalidade_codigo, m.nome AS modalidade_nome
    FROM envios e
    LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
    JOIN modalidades m ON m.id = e.modalidade_id
    JOIN unidades un ON un.id = e.unidade_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.criado_em DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);
  const { rows } = await query(sql, params);
  return rows;
}

/**
 * Muda status de um envio (aprovar/rejeitar/solicitar-ret).
 * Apenas operador_unidade da unidade ou admin_fesf.
 */
export async function mudarStatusEnvio({ envioId, novoStatus, usuarioId, motivo = null }) {
  const validos = ['em_analise', 'aguardando_ret', 'retificado', 'aprovado', 'rejeitado', 'pago'];
  if (!validos.includes(novoStatus)) {
    const e = new Error('status invalido'); e.code = 'INVALID_STATUS'; throw e;
  }
  const envio = await queryOne('SELECT * FROM envios WHERE id=$1', [envioId]);
  if (!envio) { const e = new Error('envio nao encontrado'); e.code = 'NOT_FOUND'; throw e; }

  const usr = await queryOne('SELECT * FROM usuarios WHERE id=$1', [usuarioId]);
  if (!usr) { const e = new Error('usuario nao encontrado'); e.code = 'NO_USER'; throw e; }
  if (usr.papel !== 'operador_unidade' && usr.papel !== 'admin_fesf') {
    const e = new Error('Sem permissao'); e.code = 'FORBIDDEN'; throw e;
  }
  if (usr.papel === 'operador_unidade' && usr.unidade_id !== envio.unidade_id) {
    // Verifica se a unidade do envio está na lista de extras do operador
    const { rows: extras } = await query('SELECT 1 FROM usuario_unidades WHERE usuario_id=$1 AND unidade_id=$2', [usuarioId, envio.unidade_id]);
    if (extras.length === 0) {
      const e = new Error('Envio nao pertence a sua unidade'); e.code = 'WRONG_UNIT'; throw e;
    }
  }

  // Regra: rejeitar/solicitar-ret exigem motivo
  if (['aguardando_ret', 'rejeitado'].includes(novoStatus) && (!motivo || motivo.trim().length < 5)) {
    const e = new Error('motivo obrigatorio para esta acao'); e.code = 'MOTIVO_INVALID'; throw e;
  }

  await query(
    'UPDATE envios SET status=$1, atualizado_em=CURRENT_TIMESTAMP WHERE id=$2',
    [novoStatus, envioId]
  );
  const acao = novoStatus === 'aprovado' ? 'aprovado'
             : novoStatus === 'rejeitado' ? 'rejeitado'
             : novoStatus === 'aguardando_ret' ? 'retificacao_solicitada'
             : novoStatus === 'retificado' ? 'retificado'
             : novoStatus === 'pago' ? 'marcado_pago' : `status:${novoStatus}`;
  await logar('envio', envioId, acao, usuarioId, motivo);

  // Notifica fornecedor
  const tipoNot = novoStatus === 'aprovado' ? 'envio_aprovado'
                : novoStatus === 'rejeitado' ? 'envio_rejeitado'
                : novoStatus === 'aguardando_ret' ? 'retificacao_solicitada'
                : novoStatus === 'pago' ? 'envio_pago'
                : 'sistema';
  const msg = novoStatus === 'aprovado' ? `Seu envio ${envio.protocolo} foi APROVADO`
            : novoStatus === 'rejeitado' ? `Seu envio ${envio.protocolo} foi REJEITADO. Motivo: ${motivo || '—'}`
            : novoStatus === 'aguardando_ret' ? `Retificacao solicitada no envio ${envio.protocolo}: ${motivo}`
            : novoStatus === 'pago' ? `💰 Seu envio ${envio.protocolo} foi pago${motivo ? ' · ' + motivo : ''}`
            : `Envio ${envio.protocolo}: status alterado para ${novoStatus}`;
  await notificarFornecedor({
    fornecedorId: envio.fornecedor_id, tipo: tipoNot, mensagem: msg,
    link: `/app/portal.html?envio=${envioId}`, entidade: 'envio', entidadeId: envioId,
  });

  // Notifica operadores da unidade quando fornecedor retifica (status->retificado)
  if (novoStatus === 'retificado') {
    const { rows: ops } = await query(
      `SELECT id FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1 AND ativo=TRUE`,
      [envio.unidade_id]
    );
    const { notificar } = await import('./notificacao-service.js');
    for (const op of ops) {
      await notificar({
        usuarioId: op.id, tipo: 'sistema',
        mensagem: `Fornecedor retificou o envio ${envio.protocolo} — pronto para nova análise`,
        entidade: 'envio', entidadeId: envioId,
      });
    }
  }

  return { id: envioId, status: novoStatus };
}

/**
 * Cria nova versao do envio (resposta a retificacao do fornecedor).
 */
export async function criarNovaVersao({ envioId, dadosJson, usuarioId }) {
  const envio = await queryOne('SELECT * FROM envios WHERE id=$1', [envioId]);
  if (!envio) { const e = new Error('envio nao encontrado'); e.code = 'NOT_FOUND'; throw e; }

  // proximo numero
  const { rows: [{ max }] } = await query(
    'SELECT COALESCE(MAX(numero),0)::int AS max FROM versoes_envio WHERE envio_id=$1', [envioId]
  );
  const novoNum = (max || 0) + 1;
  const { rows: [v] } = await query(
    `INSERT INTO versoes_envio (envio_id, numero, dados_json) VALUES ($1,$2,$3) RETURNING *`,
    [envioId, novoNum, typeof dadosJson === 'string' ? dadosJson : JSON.stringify(dadosJson)]
  );
  // V300: sincroniza envios.* com os campos da nova versao
  // (aceita ambos camelCase e snake_case por compat com formularios antigos/novos)
  try {
    const dados = typeof dadosJson === 'string' ? JSON.parse(dadosJson) : dadosJson;
    const valor = dados?.valor_centavos ?? dados?.valorCentavos;
    const nf    = dados?.numero_nf ?? dados?.numeroNF;
    const desc  = dados?.descricao;
    const sets = [];
    const params = [envioId];
    if (Number.isFinite(Number(valor))) { sets.push(`valor_centavos = $${sets.length + 2}`); params.push(Number(valor)); }
    if (nf)   { sets.push(`numero_nf = $${sets.length + 2}`);  params.push(String(nf)); }
    if (desc) { sets.push(`descricao = $${sets.length + 2}`); params.push(String(desc)); }
    if (sets.length) {
      sets.push('atualizado_em = CURRENT_TIMESTAMP');
      await query(`UPDATE envios SET ${sets.join(', ')} WHERE id = $1`, params);
    }
  } catch (e) { console.warn('[envio/novaVersao] sync envio.* falhou:', e.message); }
  // move status para 'retificado' se estava aguardando_ret e notifica operadores
  if (envio.status === 'aguardando_ret') {
    await query(`UPDATE envios SET status='retificado', atualizado_em=CURRENT_TIMESTAMP WHERE id=$1`, [envioId]);
    const { rows: ops } = await query(
      `SELECT id FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1 AND ativo=TRUE`,
      [envio.unidade_id]
    );
    const { notificar } = await import('./notificacao-service.js');
    for (const op of ops) {
      await notificar({
        usuarioId: op.id, tipo: 'sistema',
        mensagem: `Fornecedor retificou o envio ${envio.protocolo} (v${novoNum}) — análise reaberta`,
        entidade: 'envio', entidadeId: envioId,
      });
    }
  }
  await logar('envio', envioId, 'nova_versao', usuarioId, `v${novoNum}`);
  return v;
}

/**
 * Converte uma expectativa diretamente em envio manual (atomico).
 */
export async function converterExpectativaEmManual({ expectativaId, usuarioId, motivo, valorCentavos, numeroNF, descricao }) {
  const exp = await queryOne('SELECT * FROM expectativas WHERE id=$1', [expectativaId]);
  if (!exp) { const e = new Error('expectativa nao encontrada'); e.code = 'NOT_FOUND'; throw e; }
  if (exp.status === 'cumprida') { const e = new Error('expectativa ja foi cumprida'); e.code = 'ALREADY_DONE'; throw e; }
  if (exp.status === 'cancelada') { const e = new Error('expectativa cancelada'); e.code = 'CANCELED'; throw e; }

  const envio = await criarEnvioManual({
    usuarioId,
    fornecedorId: exp.fornecedor_id,
    unidadeId: exp.unidade_id,
    modalidadeId: exp.modalidade_id,
    competencia: exp.competencia,
    valorCentavos,
    numeroNF,
    descricao,
    motivo,
    expectativaId: exp.id,
  });
  return envio;
}

/**
 * Conta envios agrupados por origem para uma unidade.
 */
export async function resumoOrigemUnidade(unidadeId, competencia = null) {
  const params = [unidadeId];
  let where = 'unidade_id = $1';
  if (competencia) { params.push(competencia); where += ' AND competencia = $2'; }
  const { rows } = await query(
    `SELECT origem, COUNT(*)::int AS n, SUM(valor_centavos)::bigint AS total_centavos
     FROM envios WHERE ${where}
     GROUP BY origem ORDER BY origem`,
    params
  );
  return rows;
}
