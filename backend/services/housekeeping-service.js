// =====================================================================
// Housekeeping Service — jobs periodicos de limpeza, com lock single-instance.
//
// Cada job tenta INSERT em housekeeping_runs (unique em job+dia).
// Quem vence o INSERT ganha o lock e executa. Os outros recuam.
// Isso permite N replicas do servidor: so uma roda o job por dia.
// =====================================================================
import { query, queryOne } from '../db/index.js';

const JOBS = ['storage', 'notificacoes', 'auditoria', 'certidoes', 'complementos'];

/**
 * Tenta adquirir lock para um job no dia atual.
 * Retorna o id da run se ganhou, null se perdeu (outra instancia ja pegou).
 */
async function adquirirLock(job) {
  try {
    const { rows: [r] } = await query(
      `INSERT INTO housekeeping_runs (job, data_execucao_dia, status)
       VALUES ($1, CURRENT_DATE, 'em_andamento')
       ON CONFLICT (job, data_execucao_dia) DO NOTHING
       RETURNING id`,
      [job]
    );
    return r ? r.id : null;
  } catch (e) {
    return null;
  }
}

async function finalizarRun(id, status, resultado, erro = null) {
  await query(
    `UPDATE housekeeping_runs
     SET finalizado_em = CURRENT_TIMESTAMP, status = $1, resultado = $2, erro = $3
     WHERE id = $4`,
    [status, JSON.stringify(resultado || {}), erro, id]
  );
}

/**
 * Limpa arquivos orfaos em .uploads (nao referenciados em documentos.caminho).
 */
export async function rodarLimpezaStorage({ dryRun = false } = {}) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const uploadsDir = path.join(__dirname, '..', '.uploads');
  let arquivos = [];
  try { arquivos = await fs.readdir(uploadsDir); }
  catch { return { orfaos: 0, bytes: 0, nota: '.uploads vazio' }; }
  const { rows: docs } = await query('SELECT caminho FROM documentos');
  const referenciados = new Set(docs.map(d => path.basename(d.caminho)));
  let orfaos = 0, bytes = 0;
  for (const arquivo of arquivos) {
    if (referenciados.has(arquivo)) continue;
    const filePath = path.join(uploadsDir, arquivo);
    if (!filePath.startsWith(uploadsDir)) continue;
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        orfaos++; bytes += stat.size;
        if (!dryRun) await fs.unlink(filePath);
      }
    } catch {}
  }
  return { orfaos, bytes, dry_run: dryRun };
}

/**
 * Purga notificacoes LIDAS mais antigas que N dias.
 */
export async function rodarLimpezaNotificacoes({ dias = 30 } = {}) {
  const d = Math.max(7, Math.min(365, Number(dias) || 30));
  const cnt = await queryOne(
    `SELECT COUNT(*)::int AS n FROM notificacoes WHERE lida=TRUE AND criada_em < NOW() - ($1 || ' days')::interval`,
    [d]
  );
  await query(
    `DELETE FROM notificacoes WHERE lida=TRUE AND criada_em < NOW() - ($1 || ' days')::interval`,
    [d]
  );
  return { purgadas: cnt.n, dias_retencao: d };
}

const ACOES_CRITICAS = [
  'aprovado', 'rejeitado', 'retificacao_solicitada', 'marcado_pago',
  'backup_exportado', 'backup_restaurado', 'cadastro_externo', 'auto_cadastro',
  'engajamento_atualizado', 'configuracao_atualizada', 'encaminhado_sede',
  'documento_duplicado_detectado',
];

/**
 * Purga auditoria > N dias, preservando acoes criticas.
 */
export async function rodarLimpezaAuditoria({ dias = 365 } = {}) {
  const d = Math.max(90, Math.min(3650, Number(dias) || 365));
  const placeholders = ACOES_CRITICAS.map((_, i) => `$${i + 2}`).join(',');
  const params = [d, ...ACOES_CRITICAS];
  const { n: aPurgar } = await queryOne(
    `SELECT COUNT(*)::int AS n FROM auditoria
     WHERE criado_em < NOW() - ($1 || ' days')::interval
     AND acao NOT IN (${placeholders})`,
    params
  );
  await query(
    `DELETE FROM auditoria
     WHERE criado_em < NOW() - ($1 || ' days')::interval
     AND acao NOT IN (${placeholders})`,
    params
  );
  return { purgados: aPurgar, dias_retencao: d };
}

/**
 * Executa o housekeeping completo do dia (com lock).
 * Retorna o que rodou + o que foi pulado (lock perdido).
 */

/**
 * Monitora validade de certidões e envia alertas para fornecedores e operadores.
 * Roda como job diário de housekeeping.
 */
export async function rodarMonitoramentoCertidoes() {
  const { obterCertidaoConfig } = await import('./validacao-documentos-service.js');
  const config = await obterCertidaoConfig();
  if (!config.validacao_ativa) return { pulado: true, motivo: 'validacao_inativa' };

  const { enviarEmail } = await import('./email-service.js');
  const { notificar } = await import('./notificacao-service.js');

  const alertas = { dias_90: 0, dias_30: 0, dias_7: 0, vencidas: 0, erros: 0 };

  // Busca documentos com data de expiração, joins com envio + fornecedor
  const { rows } = await query(`
    SELECT
      d.id   AS doc_id,
      d.campo,
      d.nome_original,
      d.data_expiracao,
      d.status_validade,
      e.id   AS envio_id,
      e.fornecedor_id,
      e.unidade_id,
      e.protocolo,
      f.razao_social,
      f.email AS fornecedor_email,
      (d.data_expiracao - CURRENT_DATE) AS dias_restantes
    FROM documentos d
    JOIN envios e ON e.id = d.envio_id
    LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
    WHERE d.data_expiracao IS NOT NULL
      AND d.campo IN (
        'certidao_federal','cnd_federal','q15_fiscalFederal',
        'certidao_estadual','cnd_estadual','q16_fiscalEstadual',
        'certidao_municipal','cnd_municipal','q17_fiscalMunicipal',
        'cndt','q18_cndt',
        'crf_fgts','q19_crfFgts'
      )
    ORDER BY d.data_expiracao ASC
  `);

  for (const row of rows) {
    const dias = Number(row.dias_restantes);
    let nivel = null;

    if (dias < 0)          { if (config.bloquear_vencidas !== false)     { nivel = 'vencida';  alertas.vencidas++; } }
    else if (dias <= 7)    { if (config.alertar_7_dias !== false)         { nivel = '7_dias';   alertas.dias_7++;  } }
    else if (dias <= 30)   { if (config.alertar_30_dias !== false)        { nivel = '30_dias';  alertas.dias_30++; } }
    else if (dias <= 90)   { if (config.alertar_90_dias !== false)        { nivel = '90_dias';  alertas.dias_90++; } }

    if (!nivel) continue;

    const diasStr = dias < 0 ? `vencida há ${Math.abs(dias)} dia(s)` : `expira em ${dias} dia(s)`;
    const msg = `Certidão ${diasStr}: ${row.nome_original} (${row.campo}) · Protocolo ${row.protocolo}`;
    const assunto = dias < 0
      ? `[FESF-SUS] Certidão VENCIDA: ${row.nome_original}`
      : `[FESF-SUS] Certidão a vencer em ${dias} dia(s): ${row.nome_original}`;

    // Notifica fornecedor por e-mail (se tiver)
    if (row.fornecedor_email) {
      try {
        await enviarEmail({
          destinatario: row.fornecedor_email,
          assunto,
          corpo: `${msg}\n\nAcesse o portal para atualizar o documento:\nhttps://portal.fesf.ba.gov.br/app/fornecedor-docs-fixos.html`,
          tipo: 'sistema',
          entidade: 'documento',
          entidadeId: row.doc_id,
        });
      } catch (e) { alertas.erros++; }
    }

    // Notifica operadores da unidade
    try {
      const { rows: ops } = await query(
        `SELECT u.id FROM usuarios u
         LEFT JOIN usuario_unidades uu ON uu.usuario_id = u.id
         WHERE u.ativo = TRUE
           AND u.papel = 'operador_unidade'
           AND (u.unidade_id = $1 OR uu.unidade_id = $1)`,
        [row.unidade_id]
      );
      for (const op of ops) {
        await notificar({
          usuarioId: op.id,
          tipo: 'sistema',
          mensagem: msg,
          link: `/app/painel.html`,
          entidade: 'documento',
          entidadeId: row.doc_id,
        });
      }
    } catch (e) { alertas.erros++; }

    // Atualiza status_validade na tabela
    const novoStatus = dias < 0 ? 'vencido' : 'alerta';
    try {
      await query(
        `UPDATE documentos SET status_validade = $1 WHERE id = $2 AND status_validade != $1`,
        [novoStatus, row.doc_id]
      );
    } catch {}
  }

  return alertas;
}

export async function executarHousekeepingDoDia({ dryRunStorage = false } = {}) {
  const resultado = { rodados: [], pulados: [] };
  for (const job of JOBS) {
    const runId = await adquirirLock(job);
    if (!runId) { resultado.pulados.push(job); continue; }
    try {
      let r;
      if (job === 'storage') r = await rodarLimpezaStorage({ dryRun: dryRunStorage });
      else if (job === 'notificacoes') r = await rodarLimpezaNotificacoes();
      else if (job === 'auditoria') r = await rodarLimpezaAuditoria();
      else if (job === 'certidoes') r = await rodarMonitoramentoCertidoes();
      else if (job === 'complementos') {
        const { rodarAlertasComplementos } = await import('./complementos-service.js');
        r = await rodarAlertasComplementos();
      }
      await finalizarRun(runId, 'ok', r);
      resultado.rodados.push({ job, ...r });
    } catch (e) {
      await finalizarRun(runId, 'erro', null, String(e.message || e));
      resultado.rodados.push({ job, erro: String(e.message || e) });
    }
  }
  return resultado;
}

/**
 * Retorna status (ultima execucao) de cada job.
 */
export async function statusHousekeeping() {
  const status = {};
  for (const job of JOBS) {
    const r = await queryOne(
      `SELECT iniciado_em, finalizado_em, status, resultado, erro
       FROM housekeeping_runs WHERE job=$1
       ORDER BY iniciado_em DESC LIMIT 1`,
      [job]
    );
    status[job] = r ? {
      iniciado_em: r.iniciado_em, finalizado_em: r.finalizado_em,
      status: r.status, resultado: r.resultado ? JSON.parse(r.resultado) : null,
      erro: r.erro,
    } : null;
  }
  return status;
}

/**
 * Agendador interno. Roda a cada INTERVALO_MS (default 1h).
 * No primeiro tick depois das HOUSEKEEPING_HOUR (default 02:00), executa.
 * Usa CURRENT_DATE no lock, entao mesmo se rodar varias vezes/dia so executa 1x.
 */
let intervalHandle = null;
export function iniciarSchedulerHousekeeping({
  intervaloMs = 60 * 60 * 1000,  // 1h
  horaAlvo = Number(process.env.HOUSEKEEPING_HOUR || 2),
} = {}) {
  if (intervalHandle) return;
  const tick = async () => {
    const agora = new Date();
    if (agora.getHours() !== horaAlvo) return;
    try {
      const r = await executarHousekeepingDoDia();
      if (r.rodados.length && !process.env.LOG_QUIET) {
        console.log('[housekeeping]', JSON.stringify(r));
      }
    } catch (e) {
      console.error('[housekeeping] erro:', e.message);
    }
  };
  intervalHandle = setInterval(tick, intervaloMs);
  // Permite shutdown limpo (nao segura o event loop)
  if (intervalHandle.unref) intervalHandle.unref();
}

export function pararSchedulerHousekeeping() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}
