// =====================================================================
// Housekeeping Service — jobs periodicos de limpeza, com lock single-instance.
//
// Cada job tenta INSERT em housekeeping_runs (unique em job+dia).
// Quem vence o INSERT ganha o lock e executa. Os outros recuam.
// Isso permite N replicas do servidor: so uma roda o job por dia.
// =====================================================================
import { query, queryOne } from '../db/index.js';

const JOBS = ['storage', 'notificacoes', 'auditoria'];

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
