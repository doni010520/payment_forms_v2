// =====================================================================
// Email Service.
// V214: agora envia via SMTP real (nodemailer) quando configurado. Caso
// contrário, registra apenas em emails_simulados (fallback transparente).
// Em ambos os casos a tabela mantém o histórico — a coluna `enviado_real`
// distingue.
// =====================================================================
import nodemailer from 'nodemailer';
import { query, queryOne } from '../db/index.js';
import { getSmtpConfig, isSmtpEnabled } from './smtp-config-service.js';

let _transporterCache = null;
let _transporterCacheKey = null;

/**
 * Cria/reusa o transporter. Invalida automaticamente quando a config muda
 * (cache key = host+port+user). Em testes pode-se forçar reset com
 * resetTransporter().
 */
async function getTransporter() {
  const cfg = await getSmtpConfig();
  const key = `${cfg.host}|${cfg.port}|${cfg.user}|${cfg.secure ? 'tls' : 'starttls'}`;
  if (_transporterCache && _transporterCacheKey === key) return { transporter: _transporterCache, cfg };
  _transporterCache = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    // Timeouts agressivos para não pendurar o request em SMTP lerdo
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  });
  _transporterCacheKey = key;
  return { transporter: _transporterCache, cfg };
}

export function resetTransporter() {
  _transporterCache = null;
  _transporterCacheKey = null;
}

/**
 * Envia (ou simula) e-mail. Sempre persiste em emails_simulados.
 *
 * Retorna o registro inserido (com colunas enviado_real, erro_envio).
 * Erros de SMTP NÃO viram exceções — são gravados em erro_envio para
 * que o fluxo de negócio (aprovação, retificação, etc.) não falhe por
 * causa de uma queda transitória do servidor de e-mail.
 */
export async function enviarEmail({ destinatario, assunto, corpo, tipo = 'sistema', entidade = null, entidadeId = null }) {
  if (!destinatario) return null;

  let enviado_real = false;
  let erro_envio = null;
  let smtp_message_id = null;

  if (await isSmtpEnabled()) {
    try {
      const { transporter, cfg } = await getTransporter();
      const from = cfg.from_name ? `"${cfg.from_name}" <${cfg.from_email}>` : cfg.from_email;
      const info = await transporter.sendMail({
        from, to: destinatario, subject: assunto, text: corpo,
      });
      enviado_real = true;
      smtp_message_id = info.messageId || null;
    } catch (e) {
      erro_envio = String(e.message || e).substring(0, 500);
    }
  }

  const { rows: [r] } = await query(
    `INSERT INTO emails_simulados
       (destinatario, assunto, corpo, tipo, entidade, entidade_id, enviado_real, erro_envio, smtp_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [destinatario, assunto, corpo, tipo, entidade, entidadeId, enviado_real, erro_envio, smtp_message_id]
  );
  return r;
}

/**
 * Envia e-mail de teste sem persistir (usado pelo POST /api/admin/smtp/test).
 * Recebe a config diretamente (geralmente do body do request) para que o
 * admin possa testar antes de salvar.
 */
export async function enviarTestEmail({ destinatario, host, port, secure, user, password, from_name, from_email }) {
  if (!destinatario || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinatario)) {
    throw Object.assign(new Error('destinatario invalido'), { code: 'INVALID' });
  }
  if (!host) throw Object.assign(new Error('host obrigatorio'), { code: 'INVALID' });
  if (!from_email) throw Object.assign(new Error('from_email obrigatorio'), { code: 'INVALID' });

  const transporter = nodemailer.createTransport({
    host, port: Number(port) || 587, secure: !!secure,
    auth: user ? { user, pass: password || '' } : undefined,
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
  });
  const from = from_name ? `"${from_name}" <${from_email}>` : from_email;
  const info = await transporter.sendMail({
    from, to: destinatario,
    subject: '[FESF-SUS] Teste de configuração SMTP',
    text: `Este e-mail confirma que a configuração SMTP do Portal de Pagamentos FESF-SUS está funcionando corretamente.\n\nHost: ${host}:${port}\nDe: ${from}\nPara: ${destinatario}\n\nSe você recebeu esta mensagem, o sistema está pronto para enviar notificações automáticas (aprovações, lembretes, retificações).\n\nAtenciosamente,\nFESF-SUS · Portal de Pagamentos`,
  });
  return { ok: true, messageId: info.messageId || null };
}

/**
 * Helpers de template — geram assunto + corpo conforme o tipo.
 */
export const templates = {
  envio_aprovado: ({ protocolo, valor, unidade }) => ({
    assunto: `[FESF-SUS] Envio APROVADO · ${protocolo}`,
    corpo: `Olá,\n\nSeu envio ${protocolo} (valor ${valor}) à unidade ${unidade} foi APROVADO pela equipe FESF.\n\nO próximo passo é o processamento do pagamento pela FESF Sede. Você será notificado quando o pagamento for efetivado.\n\nAtenciosamente,\nFESF-SUS · Portal de Pagamentos`,
  }),
  envio_rejeitado: ({ protocolo, motivo }) => ({
    assunto: `[FESF-SUS] Envio REJEITADO · ${protocolo}`,
    corpo: `Olá,\n\nSeu envio ${protocolo} foi REJEITADO.\n\nMotivo: ${motivo || 'não especificado'}\n\nEm caso de dúvidas, entre em contato com a unidade FESF.\n\nAtenciosamente,\nFESF-SUS`,
  }),
  retificacao_solicitada: ({ protocolo, motivo }) => ({
    assunto: `[FESF-SUS] Retificação solicitada · ${protocolo}`,
    corpo: `Olá,\n\nA unidade FESF solicitou retificação no seu envio ${protocolo}.\n\nMotivo: ${motivo || 'ver detalhes no portal'}\n\nPara enviar a versão corrigida, acesse o Portal de Pagamentos:\nhttps://pagamentos.fesfsus.ba.gov.br/app/portal.html\n\nAtenciosamente,\nFESF-SUS`,
  }),
  lembrete_envio: ({ protocolo, prazo, numero }) => ({
    assunto: `[FESF-SUS] Lembrete #${numero}: documentação pendente`,
    corpo: `Olá,\n\nVerificamos que você tem documentação pendente para envio à FESF até o prazo ${prazo}.\n\nAcesse o Portal de Pagamentos para enviar:\nhttps://pagamentos.fesfsus.ba.gov.br\n\nSe já enviou, ignore este e-mail.\n\nAtenciosamente,\nFESF-SUS`,
  }),
  esqueci_senha: ({ nome }) => ({
    assunto: '[FESF-SUS] Solicitação de reset de senha recebida',
    corpo: `Olá ${nome},\n\nSua solicitação de reset de senha foi recebida. Um administrador FESF Sede entrará em contato para enviar a nova senha por canal seguro.\n\nSe não foi você que solicitou, ignore este e-mail.\n\nAtenciosamente,\nFESF-SUS`,
  }),
  envio_pago: ({ protocolo, valor, observacao }) => ({
    assunto: `[FESF-SUS] Pagamento processado · ${protocolo}`,
    corpo: `Olá,\n\nO pagamento referente ao envio ${protocolo} (valor ${valor}) foi processado pela FESF Sede.\n\n${observacao ? 'Observação: ' + observacao + '\n\n' : ''}Atenciosamente,\nFESF-SUS · Portal de Pagamentos`,
  }),
  novo_envio_op: ({ protocolo, fornecedor, unidade }) => ({
    assunto: `[FESF-SUS] Novo envio recebido na ${unidade} · ${protocolo}`,
    corpo: `Novo envio ${protocolo} aguarda análise.\n\nFornecedor: ${fornecedor}\nUnidade: ${unidade}\n\nAcesse o painel para revisar:\nhttps://pagamentos.fesfsus.ba.gov.br/app/painel.html`,
  }),
  fornecedor_aprovado: ({ razao_social, email, senha_temp }) => ({
    assunto: '[FESF-SUS] Sua conta no Portal de Pagamentos foi ativada',
    corpo: `Olá,\n\nA conta de "${razao_social}" no Portal de Pagamentos da FESF-SUS foi APROVADA e ativada.\n\nAcesso:\n  Login: ${email}\n  Senha temporária: ${senha_temp}\n\nAcesse o portal e altere a senha no primeiro login:\nhttps://pagamentos.fesfsus.ba.gov.br/app/login.html\n\nAtenciosamente,\nFESF-SUS`,
  }),
};

/**
 * Lista emails com filtros (admin).
 */
export async function listarEmails({ destinatario = null, tipo = null, limit = 50, offset = 0 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (destinatario) { where.push(`destinatario ILIKE $${params.length + 1}`); params.push(`%${destinatario}%`); }
  if (tipo)         { where.push(`tipo = $${params.length + 1}`); params.push(tipo); }
  params.push(Math.min(Number(limit) || 50, 200), Number(offset) || 0);
  const { rows } = await query(
    `SELECT id, destinatario, assunto, tipo, entidade, entidade_id, criado_em, visualizado,
            enviado_real, erro_envio, smtp_message_id
     FROM emails_simulados WHERE ${where.join(' AND ')}
     ORDER BY criado_em DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const totalParams = params.slice(0, -2);
  const total = (await query(
    `SELECT COUNT(*)::int AS n FROM emails_simulados WHERE ${where.join(' AND ')}`,
    totalParams
  )).rows[0].n;
  return { emails: rows, total };
}

export async function obterEmail(id) {
  const e = await queryOne('SELECT * FROM emails_simulados WHERE id=$1', [id]);
  if (e && !e.visualizado) {
    await query('UPDATE emails_simulados SET visualizado=TRUE WHERE id=$1', [id]);
  }
  return e;
}
