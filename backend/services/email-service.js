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
 * Envia via API HTTP do Resend (usa HTTPS:443 — funciona em qualquer hospedagem).
 * Ativado quando process.env.RESEND_API_KEY || process.env.resend_api_key está definido.
 */
async function enviarViaResendAPI({ destinatario, assunto, corpo }) {
  const apiKey = process.env.RESEND_API_KEY || process.env.resend_api_key;
  const cfg = await getSmtpConfig();
  const from = cfg.from_name
    ? `${cfg.from_name} <${cfg.from_email || 'onboarding@resend.dev'}>`
    : (cfg.from_email || 'onboarding@resend.dev');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [destinatario], subject: assunto, text: corpo }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`Resend API ${r.status}: ${err.message || JSON.stringify(err)}`);
  }
  const data = await r.json();
  return data.id || null;
}

/**
 * Envia (ou simula) e-mail. Sempre persiste em emails_simulados.
 *
 * Prioridade: 1) Resend HTTP API (RESEND_API_KEY env) 2) SMTP nodemailer 3) simulado.
 * Erros de envio NÃO viram exceções — são gravados em erro_envio para
 * que o fluxo de negócio não falhe por causa de uma queda transitória.
 */
export async function enviarEmail({ destinatario, assunto, corpo, tipo = 'sistema', entidade = null, entidadeId = null }) {
  if (!destinatario) return null;

  let enviado_real = false;
  let erro_envio = null;
  let smtp_message_id = null;

  if (process.env.RESEND_API_KEY || process.env.resend_api_key) {
    // Caminho preferido: Resend HTTP API (contorna bloqueio SMTP em hospedagens)
    try {
      smtp_message_id = await enviarViaResendAPI({ destinatario, assunto, corpo });
      enviado_real = true;
    } catch (e) {
      erro_envio = String(e.message || e).substring(0, 500);
    }
  } else if (await isSmtpEnabled()) {
    // Fallback: SMTP tradicional via nodemailer
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
 * Tenta Resend API primeiro; cai em SMTP se não houver RESEND_API_KEY.
 */
export async function enviarTestEmail({ destinatario, host, port, secure, user, password, from_name, from_email }) {
  if (!destinatario || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinatario)) {
    throw Object.assign(new Error('destinatario invalido'), { code: 'INVALID' });
  }

  // Resend HTTP API (prioridade)
  if (process.env.RESEND_API_KEY || process.env.resend_api_key) {
    const remetente = from_name ? `${from_name} <${from_email || 'onboarding@resend.dev'}>` : (from_email || 'onboarding@resend.dev');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY || process.env.resend_api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: remetente,
        to: [destinatario],
        subject: '[FESF-SUS] Teste de configuração de e-mail',
        text: `Este e-mail confirma que o Portal de Pagamentos FESF-SUS está configurado para enviar notificações reais.\n\nProvedor: Resend (API HTTP)\nDe: ${remetente}\nPara: ${destinatario}\n\nAtenciosamente,\nFESF-SUS · Portal de Pagamentos`,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`Resend API ${r.status}: ${err.message || JSON.stringify(err)}`);
    }
    const data = await r.json();
    return { ok: true, messageId: data.id || null, via: 'resend-api' };
  }

  // Fallback SMTP
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
    text: `Este e-mail confirma que a configuração SMTP do Portal de Pagamentos FESF-SUS está funcionando corretamente.\n\nHost: ${host}:${port}\nDe: ${from}\nPara: ${destinatario}\n\nAtenciosamente,\nFESF-SUS · Portal de Pagamentos`,
  });
  return { ok: true, messageId: info.messageId || null, via: 'smtp' };
}

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

  // Enviado ao fornecedor logo após a criação do envio via portal
  envio_recebido: ({ protocolo, competencia, valor, unidade, fornecedor, linkRecibo }) => ({
    assunto: `[FESF-SUS] Solicitação recebida · ${protocolo}`,
    corpo: `Olá,\n\nSua solicitação de pagamento foi recebida com sucesso pela FESF-SUS.\n\n──────────────────────────────────────\n  Protocolo:    ${protocolo}\n  Empresa:      ${fornecedor}\n  Unidade:      ${unidade}\n  Competência:  ${competencia}\n  Valor:        ${valor}\n──────────────────────────────────────\n\n📄 Recibo da solicitação (imprimir / salvar):\n${linkRecibo}\n\n🔍 Acompanhar status a qualquer momento:\nhttps://fesf-payment-forms.onrender.com/app/consulta.html\n\nPróximos passos:\n  1. Sua documentação será analisada pela equipe FESF em até 5 dias úteis.\n  2. Caso seja necessário corrigir ou complementar algum documento, você\n     receberá um novo e-mail com as instruções.\n  3. Após a aprovação, o pagamento será processado pela FESF Sede e você\n     será notificado por e-mail.\n\nGuarde o protocolo acima — ele identifica sua solicitação em qualquer\nconsulta ou contato com a FESF.\n\nAtenciosamente,\nFESF-SUS · Portal de Pagamentos\nhttps://fesf-payment-forms.onrender.com`,
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
