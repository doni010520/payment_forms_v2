// =====================================================================
// Fornecedor Service: auto-cadastro + aprovacao
// =====================================================================
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { query, queryOne } from '../db/index.js';
import { notificarAdmins, notificar } from './notificacao-service.js';

/**
 * Valida CNPJ/CPF — confere length E digitos verificadores.
 * Retorna o documento limpo (so digitos) ou null se invalido.
 */
function validaDocumento(doc) {
  const limpo = String(doc || '').replace(/\D/g, '');
  if (limpo.length === 11) {
    return validaCPF(limpo) ? limpo : null;
  }
  if (limpo.length === 14) {
    return validaCNPJ(limpo) ? limpo : null;
  }
  return null;
}

/**
 * V229/F1.1: variante com mensagem de erro específica. Permite ao backend
 * dizer "CNPJ deve ter 14 dígitos" vs "Dígito verificador inválido" em vez
 * de só "CPF/CNPJ invalido".
 */
export function validaDocumentoDetalhado(doc) {
  const limpo = String(doc || '').replace(/\D/g, '');
  if (limpo.length === 0) return { valido: false, erro: 'documento obrigatorio' };
  if (limpo.length !== 11 && limpo.length !== 14) {
    return { valido: false, limpo,
      erro: `CPF deve ter 11 dígitos ou CNPJ 14 dígitos. Você informou ${limpo.length} dígito${limpo.length === 1 ? '' : 's'}.` };
  }
  if (limpo.length === 11) {
    if (/^(\d)\1{10}$/.test(limpo)) return { valido: false, limpo, erro: 'CPF inválido (sequência repetida).' };
    if (!validaCPF(limpo)) return { valido: false, limpo, erro: 'CPF com dígito verificador inválido — confira se digitou todos os números corretamente.' };
    return { valido: true, limpo, tipo: 'CPF' };
  }
  if (/^(\d)\1{13}$/.test(limpo)) return { valido: false, limpo, erro: 'CNPJ inválido (sequência repetida).' };
  if (!validaCNPJ(limpo)) return { valido: false, limpo, erro: 'CNPJ com dígito verificador inválido — confira se digitou todos os 14 números corretamente.' };
  return { valido: true, limpo, tipo: 'CNPJ' };
}

function validaCPF(cpf) {
  // Rejeita sequencias repetidas (000..., 111..., etc.)
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  // Primeiro digito
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== Number(cpf[9])) return false;
  // Segundo digito
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === Number(cpf[10]);
}

function validaCNPJ(cnpj) {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  // Primeiro digito
  const pesos1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(cnpj[i]) * pesos1[i];
  let resto = soma % 11;
  let dig1 = resto < 2 ? 0 : 11 - resto;
  if (dig1 !== Number(cnpj[12])) return false;
  // Segundo digito
  const pesos2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma = 0;
  for (let i = 0; i < 13; i++) soma += Number(cnpj[i]) * pesos2[i];
  resto = soma % 11;
  let dig2 = resto < 2 ? 0 : 11 - resto;
  return dig2 === Number(cnpj[13]);
}

/**
 * Auto-cadastro publico (cenario: fornecedor quer comecar a usar o portal).
 * Aceita SOMENTE tipo='com_portal' — externos sao cadastrados pela FESF via outro endpoint.
 * Cria fornecedor com pendente_aprovacao=true.
 * Notifica admins FESF.
 */
export async function cadastrarFornecedor({
  tipo, razao_social, documento, email, telefone, unidades_siglas = [], nome_contato,
}) {
  // Auto-cadastro publico = somente com_portal
  if (tipo !== 'com_portal') {
    const e = new Error('Auto-cadastro publico aceita apenas tipo com_portal. Para externos, contate a unidade FESF.'); e.code = 'INVALID_TIPO'; throw e;
  }
  // E-mail eh obrigatorio para com_portal (pra receber a senha)
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const e = new Error('e-mail institucional obrigatorio'); e.code = 'INVALID_EMAIL'; throw e;
  }
  if (!razao_social || razao_social.trim().length < 3) {
    const e = new Error('razao_social obrigatoria'); e.code = 'INVALID_NAME'; throw e;
  }
  // V229/F1.1: documento validado ANTES de nome_contato — assim erros de doc
  // (mais facil de errar digitando) sao reportados primeiro, com msg detalhada.
  const docCheck = validaDocumentoDetalhado(documento);
  if (!docCheck.valido) {
    const e = new Error(docCheck.erro); e.code = 'INVALID_DOC'; throw e;
  }
  const docLimpo = docCheck.limpo;
  // PF deve ter 11 dig (CPF); PJ 14 (CNPJ)
  if (tipo === 'externo_pf' && docLimpo.length !== 11) {
    const e = new Error('Cadastro de pessoa física requer CPF (11 dígitos). Você informou um CNPJ.'); e.code = 'INVALID_DOC'; throw e;
  }
  if (tipo !== 'externo_pf' && docLimpo.length !== 14) {
    const e = new Error('Cadastro de pessoa jurídica requer CNPJ (14 dígitos). Você informou um CPF.'); e.code = 'INVALID_DOC'; throw e;
  }
  // ja existe? (V229: checado ANTES de nome_contato — quem ja existe nao deveria
  // se preocupar em refazer o cadastro com novos campos)
  const existe = await queryOne('SELECT id FROM fornecedores WHERE documento=$1', [docLimpo]);
  if (existe) { const e = new Error('CPF/CNPJ ja cadastrado'); e.code = 'DUPLICATED'; throw e; }
  // V229/F1.3: nome do contato responsavel obrigatorio em auto-cadastro com_portal
  // — sem ele, fica impossivel saber a quem dirigir notificacoes e cobranças.
  if (!nome_contato || String(nome_contato).trim().length < 3) {
    const e = new Error('nome do contato responsável é obrigatório (mín. 3 caracteres). Será usado nas comunicações.');
    e.code = 'INVALID_NAME'; throw e;
  }

  const { rows: [f] } = await query(
    `INSERT INTO fornecedores (tipo, razao_social, documento, email, telefone, nome_contato, pendente_aprovacao, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE) RETURNING *`,
    [tipo, razao_social.trim(), docLimpo, email || null, telefone || null, nome_contato.trim()]
  );

  // Vincula unidades solicitadas (se existirem)
  for (const sigla of (unidades_siglas || [])) {
    const u = await queryOne('SELECT id FROM unidades WHERE sigla=$1 AND ativa=TRUE', [sigla]);
    if (u) {
      await query(
        'INSERT INTO fornecedor_unidades (fornecedor_id, unidade_id) VALUES ($1, $2)',
        [f.id, u.id]
      );
    }
  }

  // Auditoria
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, detalhe) VALUES ('fornecedor', $1, 'auto_cadastro', $2)`,
    [f.id, `tipo=${tipo} doc=${docLimpo.substring(0,4)}***`]
  );

  // Notifica admins
  await notificarAdmins({
    tipo: 'sistema',
    mensagem: `Novo fornecedor "${razao_social}" aguarda aprovacao`,
    link: '/app/admin.html',
    entidade: 'fornecedor', entidadeId: f.id,
  });

  return { id: f.id, razao_social: f.razao_social, pendente_aprovacao: true };
}

/**
 * Cadastro de fornecedor EXTERNO feito pela FESF (operador unidade ou admin).
 * Usado quando o fornecedor NAO se cadastrou e NAO PODE/QUER usar o portal.
 * Cria fornecedor ja ativo (sem pendente_aprovacao).
 */
export async function cadastrarFornecedorExterno({
  tipo, razao_social, documento, email, telefone, unidades_ids = [], criadoPorUsuario,
}) {
  if (!tipo || !['externo_pj', 'externo_pf'].includes(tipo)) {
    const e = new Error('tipo deve ser externo_pj ou externo_pf'); e.code = 'INVALID_TIPO'; throw e;
  }
  if (!razao_social || razao_social.trim().length < 3) {
    const e = new Error('razao_social obrigatoria'); e.code = 'INVALID_NAME'; throw e;
  }
  const docLimpo = validaDocumento(documento);
  if (!docLimpo) { const e = new Error('CPF/CNPJ invalido'); e.code = 'INVALID_DOC'; throw e; }
  if (tipo === 'externo_pf' && docLimpo.length !== 11) {
    const e = new Error('PF requer CPF (11 digitos)'); e.code = 'INVALID_DOC'; throw e;
  }
  if (tipo === 'externo_pj' && docLimpo.length !== 14) {
    const e = new Error('PJ requer CNPJ (14 digitos)'); e.code = 'INVALID_DOC'; throw e;
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const e = new Error('e-mail invalido'); e.code = 'INVALID_EMAIL'; throw e;
  }
  const existe = await queryOne('SELECT id FROM fornecedores WHERE documento=$1', [docLimpo]);
  if (existe) { const e = new Error('CPF/CNPJ ja cadastrado'); e.code = 'DUPLICATED'; throw e; }

  // Operador eh da unidade que esta cadastrando; usamos a unidade dele como criado_por
  const criadoPorUnidadeId = criadoPorUsuario?.unidade_id || null;

  const { rows: [f] } = await query(
    `INSERT INTO fornecedores (tipo, razao_social, documento, email, telefone, pendente_aprovacao, ativo, criado_por_unidade_id)
     VALUES ($1, $2, $3, $4, $5, FALSE, TRUE, $6) RETURNING *`,
    [tipo, razao_social.trim(), docLimpo, email || null, telefone || null, criadoPorUnidadeId]
  );

  // Vincula unidades (apenas a unidade do operador, ou as solicitadas pelo admin)
  const unidadeIdsFinal = unidades_ids && unidades_ids.length
    ? unidades_ids
    : (criadoPorUnidadeId ? [criadoPorUnidadeId] : []);
  for (const uid of unidadeIdsFinal) {
    const u = await queryOne('SELECT id FROM unidades WHERE id=$1 AND ativa=TRUE', [uid]);
    if (u) {
      await query(
        'INSERT INTO fornecedor_unidades (fornecedor_id, unidade_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [f.id, uid]
      );
    }
  }

  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('fornecedor', $1, 'cadastro_externo', $2, $3)`,
    [f.id, criadoPorUsuario?.id, `tipo=${tipo} unidade_origem=${criadoPorUnidadeId} doc=${docLimpo.substring(0,4)}***`]
  );

  return f;
}

/**
 * Aprova fornecedor pendente. Cria usuario com senha temporaria (se com_portal).
 * Retorna { fornecedor, senha_temporaria? }
 */
export async function aprovarFornecedor({ fornecedorId, usuarioId, nomeContato = null }) {
  const f = await queryOne('SELECT * FROM fornecedores WHERE id=$1', [fornecedorId]);
  if (!f) { const e = new Error('fornecedor nao encontrado'); e.code = 'NOT_FOUND'; throw e; }
  if (!f.pendente_aprovacao) {
    const e = new Error('fornecedor ja foi processado'); e.code = 'ALREADY_PROCESSED'; throw e;
  }

  // ativa
  await query(
    `UPDATE fornecedores SET pendente_aprovacao=FALSE, ativo=TRUE WHERE id=$1`,
    [fornecedorId]
  );

  let senha_temporaria = null;
  let usuarioCriadoId = null;
  // Se tipo=com_portal e tem email, cria usuario
  if (f.tipo === 'com_portal' && f.email) {
    senha_temporaria = nanoid(10);
    const senhaHash = await bcrypt.hash(senha_temporaria, 8);
    // verifica se ja nao existe usuario com este email
    const existeUsr = await queryOne('SELECT id FROM usuarios WHERE email=$1', [f.email]);
    if (!existeUsr) {
      // V226/F1.4: fornecedor aprovado recebe senha temp → exige troca no 1º login
      const { rows: [u] } = await query(
        `INSERT INTO usuarios (papel, nome, email, senha_hash, fornecedor_id, ativo, senha_temporaria_ativa)
         VALUES ('fornecedor', $1, $2, $3, $4, TRUE, TRUE) RETURNING id`,
        // V229/F1.3: fallback agora prefere o nome_contato persistido no cadastro
        [nomeContato || f.nome_contato || `Contato · ${f.razao_social}`, f.email, senhaHash, fornecedorId]
      );
      usuarioCriadoId = u.id;
    }
  }

  // Auditoria
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('fornecedor', $1, 'aprovado', $2, $3)`,
    [fornecedorId, usuarioId, usuarioCriadoId ? `usuario criado id=${usuarioCriadoId}` : 'sem usuario portal']
  );

  // Notifica fornecedor (se criou usuario)
  if (usuarioCriadoId) {
    await notificar({
      usuarioId: usuarioCriadoId,
      tipo: 'sistema',
      mensagem: 'Bem-vindo! Sua conta foi aprovada e ja pode submeter envios.',
      link: '/app/portal.html',
    });
  }

  return { fornecedor: { id: fornecedorId, ativo: true }, senha_temporaria, usuario_id: usuarioCriadoId };
}

/**
 * Rejeita fornecedor pendente com motivo.
 */
export async function rejeitarFornecedor({ fornecedorId, usuarioId, motivo }) {
  if (!motivo || motivo.trim().length < 5) {
    const e = new Error('motivo obrigatorio (>=5 chars)'); e.code = 'MOTIVO_INVALID'; throw e;
  }
  const f = await queryOne('SELECT * FROM fornecedores WHERE id=$1', [fornecedorId]);
  if (!f) { const e = new Error('fornecedor nao encontrado'); e.code = 'NOT_FOUND'; throw e; }
  if (!f.pendente_aprovacao) {
    const e = new Error('fornecedor ja foi processado'); e.code = 'ALREADY_PROCESSED'; throw e;
  }
  await query(
    `UPDATE fornecedores SET pendente_aprovacao=FALSE, ativo=FALSE WHERE id=$1`,
    [fornecedorId]
  );
  await query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('fornecedor', $1, 'rejeitado', $2, $3)`,
    [fornecedorId, usuarioId, motivo.substring(0, 200)]
  );
  return { id: fornecedorId, ativo: false };
}

/**
 * Detalhe completo de um fornecedor: dados, KPIs, envios, expectativas, unidades.
 */
export async function detalheFornecedor(id) {
  const fornecedor = await queryOne('SELECT * FROM fornecedores WHERE id=$1', [id]);
  if (!fornecedor) { const e = new Error('nao encontrado'); e.code = 'NOT_FOUND'; throw e; }

  const totais = await queryOne(
    `SELECT
      COUNT(*)::int AS total_envios,
      COALESCE(SUM(valor_centavos),0)::bigint AS total_centavos,
      SUM(CASE WHEN status='em_analise' THEN 1 ELSE 0 END)::int AS em_analise,
      SUM(CASE WHEN status='aguardando_ret' THEN 1 ELSE 0 END)::int AS aguardando_ret,
      SUM(CASE WHEN status='aprovado' THEN 1 ELSE 0 END)::int AS aprovados,
      SUM(CASE WHEN status='pago' THEN 1 ELSE 0 END)::int AS pagos,
      SUM(CASE WHEN status='rejeitado' THEN 1 ELSE 0 END)::int AS rejeitados
     FROM envios WHERE fornecedor_id=$1`, [id]
  );

  const porOrigem = (await query(
    `SELECT origem, COUNT(*)::int AS n FROM envios WHERE fornecedor_id=$1 GROUP BY origem`, [id]
  )).rows;

  const unidades = (await query(
    `SELECT u.id, u.sigla, u.nome, u.cidade
     FROM unidades u JOIN fornecedor_unidades fu ON fu.unidade_id = u.id
     WHERE fu.fornecedor_id=$1 ORDER BY u.sigla`, [id]
  )).rows;

  const envios = (await query(
    `SELECT e.id, e.protocolo, e.competencia, e.origem, e.status, e.valor_centavos, e.criado_em,
            u.sigla AS unidade_sigla, m.nome AS modalidade_nome
     FROM envios e JOIN unidades u ON u.id=e.unidade_id JOIN modalidades m ON m.id=e.modalidade_id
     WHERE e.fornecedor_id=$1 ORDER BY e.criado_em DESC LIMIT 30`, [id]
  )).rows;

  const expectativas = (await query(
    `SELECT status, COUNT(*)::int AS n FROM expectativas WHERE fornecedor_id=$1 GROUP BY status`, [id]
  )).rows;

  // comentarios do fornecedor cross-envio (so do proprio fornecedor)
  const comentarios = (await query(
    `SELECT c.id, c.texto, c.criado_em, e.protocolo, e.id AS envio_id, u.nome AS usuario_nome, u.papel AS usuario_papel
     FROM comentarios c
     JOIN envios e ON e.id = c.envio_id
     JOIN usuarios u ON u.id = c.usuario_id
     WHERE e.fornecedor_id=$1 AND u.papel='fornecedor'
     ORDER BY c.criado_em DESC LIMIT 30`, [id]
  )).rows;

  return { fornecedor, totais, por_origem: porOrigem, unidades, envios_recentes: envios, expectativas, comentarios };
}

/**
 * Lista fornecedores pendentes de aprovacao (admin).
 */
export async function listarPendentes() {
  const { rows } = await query(
    `SELECT f.*, ARRAY(
       SELECT u.sigla FROM unidades u
       JOIN fornecedor_unidades fu ON fu.unidade_id = u.id
       WHERE fu.fornecedor_id = f.id
     ) AS unidades_siglas
     FROM fornecedores f WHERE pendente_aprovacao = TRUE ORDER BY criado_em ASC`
  );
  return rows;
}
