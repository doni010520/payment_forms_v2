// =====================================================================
// Auth Service: login, JWT, middleware
// =====================================================================
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-DEV-ONLY-change-in-prod';
const JWT_EXPIRY = '8h';

/**
 * Tenta autenticar email+senha.
 * Retorna { token, usuario } se OK, ou lanca erro com .code:
 *   'INVALID_CREDENTIALS' | 'INACTIVE'
 */
export async function login(email, senha) {
  const u = await queryOne(
    `SELECT u.*, f.razao_social AS fornecedor_razao_social, f.tipo AS fornecedor_tipo,
            un.sigla AS unidade_sigla, un.nome AS unidade_nome
     FROM usuarios u
     LEFT JOIN fornecedores f ON f.id = u.fornecedor_id
     LEFT JOIN unidades un ON un.id = u.unidade_id
     WHERE u.email = $1`,
    [email]
  );
  if (!u) {
    const e = new Error('Credenciais invalidas'); e.code = 'INVALID_CREDENTIALS'; throw e;
  }
  if (!u.ativo) {
    const e = new Error('Conta inativa'); e.code = 'INACTIVE'; throw e;
  }
  const ok = await bcrypt.compare(senha, u.senha_hash);
  if (!ok) {
    const e = new Error('Credenciais invalidas'); e.code = 'INVALID_CREDENTIALS'; throw e;
  }

  // Atualiza ultimo_login
  await query('UPDATE usuarios SET ultimo_login = CURRENT_TIMESTAMP WHERE id = $1', [u.id]);

  // Se ha revogacao recente para esse usuario com epoch >= now, garantimos
  // que o novo token seja emitido com iat > revogado_apos (evita token dead-on-arrival).
  const payload = {
    sub: u.id,
    papel: u.papel,
    fornecedor_id: u.fornecedor_id,
    unidade_id: u.unidade_id,
  };
  const rev = await queryOne('SELECT revogado_apos_epoch FROM revogacao_sessao WHERE usuario_id=$1', [u.id]).catch(() => null);
  const nowSec = Math.floor(Date.now() / 1000);
  if (rev && Number(rev.revogado_apos_epoch) >= nowSec) {
    payload.iat = Number(rev.revogado_apos_epoch) + 1;
  }
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

  // remove campos sensiveis
  const { senha_hash, ...usuarioSeguro } = u;

  return { token, usuario: usuarioSeguro };
}

/**
 * Decodifica e valida um token. Retorna o payload ou lanca.
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Retorna array com TODAS as unidade_ids que um operador pode acessar:
 * a unidade primaria + extras em usuario_unidades.
 * Para admin_fesf retorna null (acesso global).
 */
export async function getUnidadesDoOperador(usuario) {
  if (usuario.papel === 'admin_fesf') return null; // global
  if (usuario.papel !== 'operador_unidade') return [];
  const set = new Set();
  if (usuario.unidade_id) set.add(Number(usuario.unidade_id));
  const { rows } = await query('SELECT unidade_id FROM usuario_unidades WHERE usuario_id=$1', [usuario.id]);
  for (const r of rows) set.add(Number(r.unidade_id));
  return Array.from(set);
}

/**
 * Verifica se um operador pode acessar uma unidade especifica.
 * Admin: sempre TRUE. Outros: depende da lista efetiva.
 */
export async function operadorPodeAcessarUnidade(usuario, unidadeId) {
  if (usuario.papel === 'admin_fesf') return true;
  if (usuario.papel !== 'operador_unidade') return false;
  const lista = await getUnidadesDoOperador(usuario);
  return lista.includes(Number(unidadeId));
}

/**
 * Verifica se um token foi revogado.
 * Tokens emitidos ANTES de revogacao_sessao.revogado_apos sao invalidados.
 * Retorna true se revogado.
 */
export async function tokenRevogado(usuarioId, iat) {
  if (!iat) return false;
  try {
    const r = await queryOne('SELECT revogado_apos_epoch FROM revogacao_sessao WHERE usuario_id=$1', [usuarioId]);
    if (!r) return false;
    // <= captura tokens emitidos NO MESMO SEGUNDO da revogacao (mais seguro).
    // Para emitir novo token apos /me/senha, usar iatOverride = epoch + 1.
    return Math.floor(iat) <= Number(r.revogado_apos_epoch);
  } catch {
    return false; // se tabela nao existir (DB sem migration), nunca revoga
  }
}

/**
 * Revoga TODAS as sessoes ativas de um usuario.
 * Tokens emitidos antes deste momento serao rejeitados.
 * Retorna o epoch (segundos) usado, para o caller emitir token novo com iat acima.
 */
export async function revogarSessoesDoUsuario(usuarioId, { revogadoPor = null, motivo = null } = {}) {
  // Monotonicidade: epoch sempre avanca pelo menos +1s sobre revogacao anterior
  // do mesmo usuario. Garante que duas revogacoes em <1s nao deixem brechas.
  const existing = await queryOne('SELECT revogado_apos_epoch FROM revogacao_sessao WHERE usuario_id=$1', [usuarioId]);
  const candidato = Math.floor(Date.now() / 1000);
  const nowEpoch = existing ? Math.max(candidato, Number(existing.revogado_apos_epoch) + 1) : candidato;
  await query(
    `INSERT INTO revogacao_sessao (usuario_id, revogado_apos_epoch, revogado_por, motivo)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (usuario_id) DO UPDATE SET
       revogado_apos_epoch = EXCLUDED.revogado_apos_epoch,
       revogado_por = EXCLUDED.revogado_por,
       motivo = EXCLUDED.motivo`,
    [usuarioId, nowEpoch, revogadoPor, motivo]
  );
  return nowEpoch;
}

/**
 * Gera um JWT para um usuario existente. Util para fluxos pos-mudanca-de-senha
 * (mantem usuario logado mesmo apos revogacao). Opcoes:
 *   iatOverride: forca o "issued at" (segundos epoch) — usado para emitir token
 *                acima do timestamp de revogacao recen registrada.
 */
export async function gerarTokenParaUsuario(usuarioId, { iatOverride = null } = {}) {
  const u = await queryOne('SELECT id, papel, fornecedor_id, unidade_id FROM usuarios WHERE id=$1', [usuarioId]);
  if (!u) { const e = new Error('usuario nao encontrado'); e.code='NOT_FOUND'; throw e; }
  const payload = {
    sub: u.id, papel: u.papel,
    fornecedor_id: u.fornecedor_id, unidade_id: u.unidade_id,
  };
  if (iatOverride != null) {
    // Quando forcamos iat, precisamos colocar tambem no payload (jwt.sign respeita)
    payload.iat = iatOverride;
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY, noTimestamp: false });
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Middleware Express: exige token Bearer valido E NAO revogado.
 * Popula req.usuario com {id, papel, fornecedor_id, unidade_id}.
 */
// V226/F1.4: endpoints liberados mesmo com senha temporária ativa.
// Tudo o que não estiver aqui fica bloqueado até o usuário trocar a senha.
const PATHS_LIBERADOS_SENHA_TEMP = [
  /^\/api\/me$/,                  // GET dados do próprio usuário
  /^\/api\/me\/senha$/,           // POST trocar senha — a saída do bloqueio
  /^\/api\/me\/unidades$/,        // GET unidades acessíveis (loading do portal)
  /^\/api\/auth\/logout$/,        // POST sair
  /^\/api\/notificacoes/,         // GET notificações (read-only, útil mostrar)
  /^\/api\/health/,               // health checks
  /^\/api\/version$/,
  /^\/api\/system-banner$/,
];

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Token ausente' });
  try {
    const payload = verifyToken(m[1]);
    if (await tokenRevogado(payload.sub, payload.iat)) {
      return res.status(401).json({ error: 'Sessao revogada', code: 'SESSION_REVOKED' });
    }
    req.usuario = {
      id: payload.sub,
      papel: payload.papel,
      fornecedor_id: payload.fornecedor_id,
      unidade_id: payload.unidade_id,
    };
    // V226/F1.4: bloqueia uso normal do sistema enquanto senha temporária estiver ativa.
    // Carrega o flag do DB (não cabe no JWT pra refletir mudanças sem reemitir).
    // GET é tolerado para algumas rotas de leitura (whitelist); writes (POST/PUT/PATCH/DELETE)
    // só passam pelas rotas explicitamente liberadas.
    const u = await queryOne('SELECT senha_temporaria_ativa FROM usuarios WHERE id=$1', [payload.sub]);
    if (u && u.senha_temporaria_ativa) {
      req.usuario.senha_temporaria_ativa = true;
      // originalUrl inclui prefixo /api/ + query string (basta o pathname pro match)
      const fullPath = (req.originalUrl || req.url || '').split('?')[0];
      const liberado = PATHS_LIBERADOS_SENHA_TEMP.some(re => re.test(fullPath));
      if (!liberado) {
        return res.status(403).json({
          error: 'Sua senha é temporária. Defina uma nova senha antes de usar o sistema.',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
      }
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido ou expirado' });
  }
}

/**
 * Middleware Express: exige papel especifico.
 * Uso: requireRole('operador_unidade')
 */
export function requireRole(...papeis) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Nao autenticado' });
    if (!papeis.includes(req.usuario.papel)) {
      return res.status(403).json({ error: 'Acesso negado para este papel' });
    }
    next();
  };
}
