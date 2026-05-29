/**
 * complementos-service.js
 * -----------------------
 * Gerencia complementos pendentes — documentos que o fornecedor sinaliza
 * que vai enviar APÓS o pagamento dos encargos (geralmente GPS/FGTS, que
 * só ficam disponíveis após o dia 20 do mês seguinte à competência).
 *
 * Fluxo:
 *  1. Fornecedor cria envio + array de campos para complementar depois
 *  2. registrarComplementos() insere em complementos_pendentes com
 *     data_esperada calculada (dia 20 do mês seguinte à competência)
 *  3. Quando o doc chega via upload normal, marcarComplementoRecebido()
 *     atualiza a flag automaticamente
 *  4. Job housekeeping verifica D-3 / D e dispara alertas
 */

import { query, queryOne } from '../db/index.js';

// Campos que tipicamente precisam de complemento (vinculados a encargos pagos)
// Tanto operador quanto fornecedor podem marcar outros campos, mas estes têm
// suporte semântico explícito.
const CAMPOS_PADRAO_LABELS = {
  gps:          'GPS (INSS) com comprovante de pagamento',
  fgts:         'GRF (FGTS) com comprovante de pagamento',
  grf:          'GRF (FGTS) com comprovante de pagamento',
  guia_inss:    'Guia de INSS com comprovante de pagamento',
  guia_fgts:    'Guia de FGTS com comprovante de pagamento',
};

const MOTIVO_PADRAO = 'Encargo trabalhista — liberado pela Receita/Caixa apenas após o dia 20 do mês seguinte à competência';

/**
 * Calcula a data_esperada do complemento.
 * Regra: dia 20 do mês seguinte à competência.
 * Ex: competência 2026-02 → 2026-03-20
 *
 * @param {string} competencia - formato 'YYYY-MM'
 * @returns {string} ISO date 'YYYY-MM-DD'
 */
export function calcularDataEsperada(competencia) {
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
    // Default: dia 20 do mês corrente
    const hoje = new Date();
    return new Date(hoje.getFullYear(), hoje.getMonth(), 20).toISOString().slice(0, 10);
  }
  const [yyyy, mm] = competencia.split('-').map(Number);
  // Mês seguinte (JavaScript Date trata overflow automaticamente: mes 13 → ano+1, mes 1)
  const dt = new Date(Date.UTC(yyyy, mm, 20));  // mm aqui já é "mês seguinte" pois Date usa 0-index
  return dt.toISOString().slice(0, 10);
}

/**
 * Registra complementos pendentes para um envio recém-criado.
 * Idempotente — não duplica se já existe (UNIQUE envio_id+campo).
 *
 * @param {object} opts
 * @param {number} opts.envioId
 * @param {string[]} opts.campos - lista de campos: ['gps', 'fgts']
 * @param {string} opts.competencia - 'YYYY-MM' usada para calcular data_esperada
 * @param {number} [opts.criadoPorId]
 * @returns {Promise<object[]>} complementos criados
 */
export async function registrarComplementos({ envioId, campos, competencia, criadoPorId }) {
  if (!envioId || !Array.isArray(campos) || campos.length === 0) return [];

  const dataEsperada = calcularDataEsperada(competencia);
  const criados = [];

  for (const campoRaw of campos) {
    const campo = String(campoRaw).trim().toLowerCase();
    if (!campo) continue;
    const label = CAMPOS_PADRAO_LABELS[campo] || `Documento complementar: ${campo}`;
    try {
      const r = await queryOne(
        `INSERT INTO complementos_pendentes
           (envio_id, campo, label, motivo, data_esperada, criado_por_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (envio_id, campo) DO NOTHING
         RETURNING *`,
        [envioId, campo, label, MOTIVO_PADRAO, dataEsperada, criadoPorId || null]
      );
      if (r) criados.push(r);
    } catch (e) {
      console.error(`[complementos] falha ao registrar ${campo}:`, e.message);
    }
  }

  return criados;
}

/**
 * Lista complementos pendentes de um envio.
 */
export async function listarComplementosDoEnvio(envioId) {
  const { rows } = await query(
    `SELECT cp.id, cp.campo, cp.label, cp.motivo, cp.data_esperada, cp.status,
            cp.documento_id, cp.recebido_em, cp.criado_em,
            d.nome_original AS documento_nome
     FROM complementos_pendentes cp
     LEFT JOIN documentos d ON d.id = cp.documento_id
     WHERE cp.envio_id = $1
     ORDER BY cp.data_esperada ASC, cp.campo ASC`,
    [envioId]
  );
  return rows;
}

/**
 * Quando um documento é enviado, verifica se atende algum complemento pendente
 * do mesmo envio+campo e marca como recebido automaticamente.
 *
 * @returns {Promise<boolean>} true se atendeu algum complemento
 */
export async function marcarComplementoRecebido({ envioId, campo, documentoId }) {
  if (!envioId || !campo) return false;
  const campoNorm = String(campo).trim().toLowerCase();
  const r = await queryOne(
    `UPDATE complementos_pendentes
     SET status = 'recebido',
         documento_id = $1,
         recebido_em = CURRENT_TIMESTAMP
     WHERE envio_id = $2 AND campo = $3 AND status = 'pendente'
     RETURNING id, label`,
    [documentoId, envioId, campoNorm]
  );
  return !!r;
}

/**
 * Conta quantos complementos ainda pendentes existem para um envio.
 * Útil para o aviso visual antes de pagar.
 */
export async function contarPendentesDoEnvio(envioId) {
  const r = await queryOne(
    `SELECT COUNT(*)::int AS n
     FROM complementos_pendentes
     WHERE envio_id = $1 AND status = 'pendente'`,
    [envioId]
  );
  return r?.n || 0;
}

/**
 * Job de housekeeping: notifica fornecedores sobre complementos chegando ao prazo.
 * Roda diariamente. Idempotente — usa flags alerta_d3_enviado / alerta_d0_enviado.
 */
export async function rodarAlertasComplementos() {
  const { enviarEmail } = await import('./email-service.js');
  const { notificar } = await import('./notificacao-service.js');

  const stats = { d3: 0, d0: 0, vencidos: 0, erros: 0 };

  // ---- Alerta D-3 (3 dias antes da data esperada) ----
  const { rows: d3 } = await query(
    `SELECT cp.id, cp.campo, cp.label, cp.data_esperada, cp.envio_id,
            e.protocolo, e.fornecedor_id, f.email AS fornecedor_email, f.razao_social
     FROM complementos_pendentes cp
     JOIN envios e ON e.id = cp.envio_id
     LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
     WHERE cp.status = 'pendente'
       AND cp.data_esperada = (CURRENT_DATE + INTERVAL '3 days')::date
       AND cp.alerta_d3_enviado = FALSE`
  );

  for (const c of d3) {
    try {
      const msg = `Complemento "${c.label}" do envio ${c.protocolo} esperado em 3 dias (${new Date(c.data_esperada).toLocaleDateString('pt-BR')}). Após o pagamento do encargo, envie o comprovante.`;
      const { rows: usrs } = await query(
        `SELECT id FROM usuarios WHERE fornecedor_id = $1 AND ativo = TRUE`,
        [c.fornecedor_id]
      );
      for (const u of usrs) {
        await notificar({
          usuarioId: u.id, tipo: 'sistema',
          mensagem: msg,
          entidade: 'envio', entidadeId: c.envio_id,
        });
      }
      if (c.fornecedor_email) {
        await enviarEmail({
          destinatario: c.fornecedor_email,
          assunto: `[FESF-SUS] Lembrete — Complemento ${c.label} em 3 dias`,
          corpo: msg,
          tipo: 'sistema', entidade: 'envio', entidadeId: c.envio_id,
        });
      }
      await query(
        `UPDATE complementos_pendentes SET alerta_d3_enviado = TRUE WHERE id = $1`,
        [c.id]
      );
      stats.d3++;
    } catch (e) { stats.erros++; console.error('[complementos/d3]', e.message); }
  }

  // ---- Alerta D (no dia esperado) ----
  const { rows: d0 } = await query(
    `SELECT cp.id, cp.campo, cp.label, cp.data_esperada, cp.envio_id,
            e.protocolo, e.fornecedor_id, f.email AS fornecedor_email, f.razao_social
     FROM complementos_pendentes cp
     JOIN envios e ON e.id = cp.envio_id
     LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
     WHERE cp.status = 'pendente'
       AND cp.data_esperada = CURRENT_DATE
       AND cp.alerta_d0_enviado = FALSE`
  );

  for (const c of d0) {
    try {
      const msg = `Hoje é a data esperada do complemento "${c.label}" do envio ${c.protocolo}. Envie o comprovante o quanto antes para não atrasar o pagamento.`;
      const { rows: usrs } = await query(
        `SELECT id FROM usuarios WHERE fornecedor_id = $1 AND ativo = TRUE`,
        [c.fornecedor_id]
      );
      for (const u of usrs) {
        await notificar({
          usuarioId: u.id, tipo: 'sistema',
          mensagem: msg,
          entidade: 'envio', entidadeId: c.envio_id,
        });
      }
      if (c.fornecedor_email) {
        await enviarEmail({
          destinatario: c.fornecedor_email,
          assunto: `[FESF-SUS] HOJE — Complemento ${c.label} esperado`,
          corpo: msg,
          tipo: 'sistema', entidade: 'envio', entidadeId: c.envio_id,
        });
      }
      await query(
        `UPDATE complementos_pendentes SET alerta_d0_enviado = TRUE WHERE id = $1`,
        [c.id]
      );
      stats.d0++;
    } catch (e) { stats.erros++; console.error('[complementos/d0]', e.message); }
  }

  // ---- Marcar como vencido (passou D+7 sem ser recebido) ----
  const { rows: venc } = await query(
    `UPDATE complementos_pendentes
     SET status = 'vencido'
     WHERE status = 'pendente'
       AND data_esperada < (CURRENT_DATE - INTERVAL '7 days')::date
     RETURNING id, envio_id`
  );
  stats.vencidos = venc.length;

  return stats;
}
