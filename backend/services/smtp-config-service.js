// =====================================================================
// V214: serviço de configuração SMTP.
// Lê/grava a chave 'smtp' da tabela `configuracoes`. Senha encriptada
// via AES-256-GCM (services/crypto-helper.js). Os demais campos ficam
// em claro (host, port, user, etc.) — apenas a senha precisa de proteção.
// =====================================================================
import { query, queryOne } from '../db/index.js';
import { encrypt, decrypt, mascarar } from './crypto-helper.js';

const CHAVE = 'smtp';

const DEFAULT = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,        // true = porta 465 SSL; false = STARTTLS na 587
  user: '',
  password: '',         // só para input em memória — sai como password_enc no banco
  from_name: 'FESF-SUS · Portal de Pagamentos',
  from_email: '',
};

/**
 * Lê config bruta do banco. Decripta password e devolve em claro.
 * Se não houver registro, devolve DEFAULT (disabled).
 */
export async function getSmtpConfig() {
  const r = await queryOne('SELECT valor FROM configuracoes WHERE chave=$1', [CHAVE]);
  if (!r) return { ...DEFAULT };
  let parsed;
  try { parsed = JSON.parse(r.valor); } catch { return { ...DEFAULT }; }
  const password = parsed.password_enc ? decrypt(parsed.password_enc) : '';
  return {
    enabled:    !!parsed.enabled,
    host:       parsed.host || '',
    port:       Number(parsed.port) || 587,
    secure:     !!parsed.secure,
    user:       parsed.user || '',
    password:   password || '',
    from_name:  parsed.from_name || DEFAULT.from_name,
    from_email: parsed.from_email || '',
  };
}

/**
 * Versão "segura para UI": password vem mascarada.
 * Usar no GET /api/admin/smtp.
 */
export async function getSmtpConfigPublic() {
  const c = await getSmtpConfig();
  return { ...c, password: mascarar(c.password), tem_password: !!c.password };
}

/**
 * Salva config. Se `password` vier vazia/null, mantém a anterior (permite
 * editar outros campos sem reentrar a senha).
 */
export async function saveSmtpConfig(input, { porUsuarioId } = {}) {
  const atual = await getSmtpConfig();
  const passwordNova = (typeof input.password === 'string' && input.password.length > 0)
    ? input.password
    : atual.password;
  const payload = {
    enabled:    !!input.enabled,
    host:       String(input.host || '').trim(),
    port:       Number(input.port) || 587,
    secure:     !!input.secure,
    user:       String(input.user || '').trim(),
    password_enc: passwordNova ? encrypt(passwordNova) : null,
    from_name:  String(input.from_name || DEFAULT.from_name).trim(),
    from_email: String(input.from_email || '').trim(),
  };
  // Validações mínimas
  if (payload.enabled) {
    if (!payload.host)      throw Object.assign(new Error('host obrigatorio quando enabled'),      { code: 'INVALID' });
    if (!payload.from_email) throw Object.assign(new Error('from_email obrigatorio quando enabled'), { code: 'INVALID' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.from_email)) {
      throw Object.assign(new Error('from_email invalido'), { code: 'INVALID' });
    }
  }
  const json = JSON.stringify(payload);
  const existe = await queryOne('SELECT chave FROM configuracoes WHERE chave=$1', [CHAVE]);
  if (existe) {
    await query(`UPDATE configuracoes SET valor=$1, atualizado_em=CURRENT_TIMESTAMP, atualizado_por=$2 WHERE chave=$3`,
      [json, porUsuarioId || null, CHAVE]);
  } else {
    await query(`INSERT INTO configuracoes (chave, valor, atualizado_por) VALUES ($1, $2, $3)`,
      [CHAVE, json, porUsuarioId || null]);
  }
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('configuracao', 0, 'smtp_atualizado', $1, $2)`,
    [porUsuarioId || null, `host=${payload.host} enabled=${payload.enabled} user=${payload.user}`]
  );
  return { ok: true };
}

export async function isSmtpEnabled() {
  if (process.env.SMTP_DISABLED === '1') return false;
  const c = await getSmtpConfig();
  return !!(c.enabled && c.host && c.from_email);
}
