// =====================================================================
// Usuario Service: CRUD admin (operadores/admins) + reset senha
// =====================================================================
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { query, queryOne } from '../db/index.js';
import { notificar } from './notificacao-service.js';

export async function listarUsuarios({ papel = null, unidade_id = null } = {}) {
  const where = ['1=1'];
  const params = [];
  if (papel)       { where.push(`u.papel = $${params.length+1}`); params.push(papel); }
  if (unidade_id)  { where.push(`u.unidade_id = $${params.length+1}`); params.push(Number(unidade_id)); }
  const { rows } = await query(
    `SELECT u.id, u.papel, u.nome, u.email, u.ativo, u.criado_em, u.ultimo_login,
            u.unidade_id, un.sigla AS unidade_sigla, un.nome AS unidade_nome,
            u.fornecedor_id, f.razao_social AS fornecedor_razao_social
     FROM usuarios u
     LEFT JOIN unidades un ON un.id = u.unidade_id
     LEFT JOIN fornecedores f ON f.id = u.fornecedor_id
     WHERE ${where.join(' AND ')}
     ORDER BY u.papel, u.nome`,
    params
  );
  return rows;
}

/**
 * Cria operador de unidade ou admin FESF.
 * (Fornecedores sao criados via aprovacao em fornecedor-service.)
 */
export async function criarUsuario({ papel, nome, email, unidade_id, senhaInicial = null }) {
  if (!['operador_unidade', 'admin_fesf'].includes(papel)) {
    const e = new Error('papel deve ser operador_unidade ou admin_fesf'); e.code = 'INVALID_PAPEL'; throw e;
  }
  if (papel === 'operador_unidade' && !unidade_id) {
    const e = new Error('operador requer unidade_id'); e.code = 'INVALID_UNIDADE'; throw e;
  }
  if (!nome || nome.trim().length < 3) { const e = new Error('nome invalido'); e.code='INVALID_NAME'; throw e; }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const e = new Error('email invalido'); e.code='INVALID_EMAIL'; throw e;
  }
  const existe = await queryOne('SELECT id FROM usuarios WHERE email=$1', [email]);
  if (existe) { const e = new Error('email ja em uso'); e.code='DUPLICATED'; throw e; }
  // Se for operador, valida unidade
  if (papel === 'operador_unidade') {
    const u = await queryOne('SELECT id FROM unidades WHERE id=$1 AND ativa=TRUE', [unidade_id]);
    if (!u) { const e = new Error('unidade nao encontrada ou inativa'); e.code='INVALID_UNIDADE'; throw e; }
  }
  const senha = senhaInicial || nanoid(10);
  const hash = await bcrypt.hash(senha, 8);
  // V226/F1.4: marca senha_temporaria_ativa=TRUE quando o admin não forneceu
  // senha explícita (caso padrão — senha gerada e enviada por canal seguro).
  const senhaEhTemp = !senhaInicial;
  const { rows: [usr] } = await query(
    `INSERT INTO usuarios (papel, nome, email, senha_hash, unidade_id, ativo, senha_temporaria_ativa)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6) RETURNING id`,
    [papel, nome.trim(), email, hash, papel === 'operador_unidade' ? unidade_id : null, senhaEhTemp]
  );
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, detalhe) VALUES ('usuario', $1, 'criado', $2)`,
    [usr.id, `papel=${papel} email=${email}`]
  );
  return { id: usr.id, senha_temporaria: senha };
}

export async function atualizarUsuario(id, { nome, ativo, unidade_id }) {
  const u = await queryOne('SELECT * FROM usuarios WHERE id=$1', [id]);
  if (!u) { const e = new Error('usuario nao encontrado'); e.code='NOT_FOUND'; throw e; }
  const novoNome = nome?.trim() || u.nome;
  const novoAtivo = ativo == null ? u.ativo : !!ativo;
  let novaUnidade = u.unidade_id;
  if (u.papel === 'operador_unidade' && unidade_id != null) {
    novaUnidade = Number(unidade_id);
  }
  await query(`UPDATE usuarios SET nome=$1, ativo=$2, unidade_id=$3 WHERE id=$4`, [novoNome, novoAtivo, novaUnidade, id]);
  return { id, nome: novoNome, ativo: novoAtivo, unidade_id: novaUnidade };
}

export async function resetarSenha(id, { porUsuarioId, novaSenha = null }) {
  const u = await queryOne('SELECT * FROM usuarios WHERE id=$1', [id]);
  if (!u) { const e = new Error('usuario nao encontrado'); e.code='NOT_FOUND'; throw e; }
  const senha = novaSenha || nanoid(10);
  const hash = await bcrypt.hash(senha, 8);
  // V226/F1.4: reset por admin gera senha temp → exige troca no próximo login.
  // Se o admin forneceu senha pessoal (caso raro), não força troca.
  const senhaEhTemp = !novaSenha;
  await query(`UPDATE usuarios SET senha_hash=$1, senha_temporaria_ativa=$2 WHERE id=$3`, [hash, senhaEhTemp, id]);
  // SEGURANCA: revoga sessoes ativas para evitar que sessao com senha velha
  // continue funcionando. Lazy-import evita ciclo entre auth-service e usuario-service.
  try {
    const { revogarSessoesDoUsuario } = await import('./auth-service.js');
    await revogarSessoesDoUsuario(id, { revogadoPor: porUsuarioId, motivo: 'senha resetada por admin' });
  } catch (e) { /* nao quebra o reset se revocacao falhar */ }
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('usuario', $1, 'senha_resetada', $2, $3)`,
    [id, porUsuarioId, novaSenha ? 'senha fornecida' : 'senha gerada']
  );
  // notifica o proprio usuario in-app
  await notificar({
    usuarioId: id, tipo: 'sistema',
    mensagem: 'Sua senha foi resetada por um administrador. Use a nova senha enviada por canal seguro.',
  });
  return { senha_temporaria: senha };
}

/**
 * Auto-troca de senha (usuario logado muda a propria).
 * Retorna { ok, novo_token } — o token atual eh invalidado pela revogacao,
 * mas devolvemos um token novo para o usuario nao ser deslogado (UX).
 */
export async function alterarMinhaSenha({ usuarioId, senhaAtual, novaSenha }) {
  if (!novaSenha || novaSenha.length < 6) {
    const e = new Error('nova senha deve ter >=6 chars'); e.code='INVALID_SENHA'; throw e;
  }
  const u = await queryOne('SELECT * FROM usuarios WHERE id=$1', [usuarioId]);
  if (!u) { const e = new Error('usuario nao encontrado'); e.code='NOT_FOUND'; throw e; }
  const ok = await bcrypt.compare(senhaAtual, u.senha_hash);
  if (!ok) { const e = new Error('senha atual incorreta'); e.code='WRONG_PASSWORD'; throw e; }
  const hash = await bcrypt.hash(novaSenha, 8);
  // V226/F1.4: ao trocar pessoalmente, limpa o flag senha_temporaria_ativa
  await query(`UPDATE usuarios SET senha_hash=$1, senha_temporaria_ativa=FALSE WHERE id=$2`, [hash, usuarioId]);
  // SEGURANCA: invalida tokens antigos (sessoes em outros dispositivos).
  // Depois gera token novo com iat custom (= revogado_apos + 1s) p/ NAO ser
  // capturado pela propria revogacao — evita 1s de wait blocking.
  let novoToken = null;
  try {
    const { revogarSessoesDoUsuario, gerarTokenParaUsuario } = await import('./auth-service.js');
    const epochRevogado = await revogarSessoesDoUsuario(usuarioId, { revogadoPor: usuarioId, motivo: 'troca de senha' });
    novoToken = await gerarTokenParaUsuario(usuarioId, { iatOverride: epochRevogado + 1 });
  } catch (e) { /* nao quebra se sessao tokens falharem */ }
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id) VALUES ('usuario', $1, 'senha_alterada', $2)`,
    [usuarioId, usuarioId]
  );
  return { ok: true, novo_token: novoToken };
}
