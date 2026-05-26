// =====================================================================
// V214: Helper de criptografia simétrica para segredos persistidos.
// Uso atual: senha SMTP guardada na tabela configuracoes.
//
// Estratégia:
//   - AES-256-GCM (autenticada — detecta adulteração)
//   - chave derivada via scrypt do APP_ENCRYPTION_KEY (env var)
//   - formato armazenado: "v1:<iv_hex>:<tag_hex>:<ciphertext_hex>"
//
// Em produção, defina APP_ENCRYPTION_KEY (32+ chars, alta entropia).
// Em dev/test usamos um fallback fixo só para o sistema funcionar localmente.
// =====================================================================
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';

const ALGO = 'aes-256-gcm';
const SALT = Buffer.from('fesf-sus-portal-v214-smtp-salt'); // constante OK para derivação de chave fixa
const KEY_LEN = 32;
const IV_LEN  = 12;

function getKey() {
  const secret = process.env.APP_ENCRYPTION_KEY
    || 'dev-only-key-troque-em-producao-fesf-sus-2026';
  if (process.env.NODE_ENV === 'production' && secret === 'dev-only-key-troque-em-producao-fesf-sus-2026') {
    console.warn('[crypto-helper] APP_ENCRYPTION_KEY nao definida em producao — usando fallback inseguro');
  }
  return scryptSync(secret, SALT, KEY_LEN);
}

export function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(stored) {
  if (!stored || typeof stored !== 'string') return null;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    // formato desconhecido / não-encriptado → devolve null para forçar reconfiguração
    return null;
  }
  try {
    const iv  = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const ct  = Buffer.from(parts[3], 'hex');
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (e) {
    // chave mudou ou ciphertext adulterado — null sinaliza "precisa reconfigurar"
    return null;
  }
}

/**
 * Mascara um segredo para exibir em UI sem expor o valor real.
 * "abcdef1234" → "ab****34"
 */
export function mascarar(secret) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= 4) return '*'.repeat(s.length);
  return s.substring(0, 2) + '*'.repeat(Math.min(6, s.length - 4)) + s.substring(s.length - 2);
}
