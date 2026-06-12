// API client compartilhado entre todas as paginas
// V291: importa error-logger para instalar captura global de erros do cliente
import './error-logger.js';

const TOKEN_KEY = 'fesf_token';
const USR_KEY   = 'fesf_usuario';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getUsuario() { try { return JSON.parse(localStorage.getItem(USR_KEY) || 'null'); } catch { return null; } }
export function setSession({ token, usuario }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USR_KEY, JSON.stringify(usuario));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USR_KEY);
}

function handleUnauthorized(status) {
  if (status === 401 && !location.pathname.endsWith('/login.html')) {
    clearSession();
    location.href = '/app/login.html';
    return true;
  }
  return false;
}

async function req(method, path, body, { authenticated = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const r = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) {
    if (authenticated && handleUnauthorized(r.status)) return;
    if (json && json.code === 'PASSWORD_CHANGE_REQUIRED'
        && !location.pathname.endsWith('/trocar-senha.html')) {
      location.href = '/app/trocar-senha.html';
    }
    const err = new Error((json && json.error) || `HTTP ${r.status}`);
    err.status = r.status; err.code = json && json.code; err.json = json;
    throw err;
  }
  return json;
}

export const api = {
  // auth
  login: (email, senha) => req('POST', '/api/auth/login', { email, senha }, { authenticated: false }),
  esqueciSenha: (email) => req('POST', '/api/auth/esqueci-senha', { email }, { authenticated: false }),
  // listas
  unidades: () => req('GET', '/api/unidades', null, { authenticated: false }),
  // V214/F1.5: SO as unidades que o usuario logado pode acessar
  minhasUnidades: () => req('GET', '/api/me/unidades'),
  modalidades: () => req('GET', '/api/modalidades', null, { authenticated: false }),
  fornecedores: (tipo) => req('GET', `/api/fornecedores${tipo ? `?tipo=${tipo}` : ''}`),
  // envios
  envios: ({ origem, status, competencia, unidade_id } = {}) => {
    const q = new URLSearchParams(); if (origem) q.set('origem',origem); if (status) q.set('status',status); if (competencia) q.set('competencia',competencia); if (unidade_id) q.set('unidade_id',unidade_id);
    return req('GET', `/api/envios${q.toString() ? `?${q}` : ''}`);
  },
  envio: (id) => req('GET', `/api/envios/${id}`),
  resumoOrigem: ({ competencia, unidade_id } = {}) => {
    const q = new URLSearchParams(); if (competencia) q.set('competencia',competencia); if (unidade_id) q.set('unidade_id',unidade_id);
    return req('GET', `/api/envios/resumo/origem${q.toString() ? `?${q}` : ''}`);
  },
  criarEnvioPortal:  (body) => req('POST', '/api/envios/portal', body),
  criarEnvioManual:  (body) => req('POST', '/api/envios/manual', body),
  criarEnvioPublico: (token, body) => req('POST', `/api/envios/publico/${token}`, body, { authenticated: false }),
  aprovarEnvio:  (id, observacao) => req('POST', `/api/envios/${id}/aprovar`, { observacao }),
  rejeitarEnvio: (id, motivo)     => req('POST', `/api/envios/${id}/rejeitar`, { motivo }),
  solicitarRet:  (id, motivo)     => req('POST', `/api/envios/${id}/solicitar-retificacao`, { motivo }),
  marcarPago:    (id, observacao) => req('POST', `/api/envios/${id}/marcar-pago`, { observacao }),
  marcarPagoLote: (ids, observacao) => req('POST', '/api/envios/bulk/marcar-pago', { ids, observacao }),
  anotarCampo:   (id, body) => req('POST', `/api/envios/${id}/anotacoes`, body),
  criarVersao:   (id, body)       => req('POST', `/api/envios/${id}/versoes`, body),
  comentar:      (id, texto)      => req('POST', `/api/envios/${id}/comentarios`, { texto }),
  // links publicos
  criarLink: (body) => req('POST', '/api/links', body),
  lookupLink: (token) => req('GET', `/api/links/${token}`, null, { authenticated: false }),
  listarLinksUnidade: (unidadeId) => req('GET', `/api/links/unidade/${unidadeId}`),
  // expectativas
  criarExpectativa: (body) => req('POST', '/api/expectativas', body),
  listarExpectativas: ({ status, competencia, unidade_id } = {}) => {
    const q = new URLSearchParams(); if (status) q.set('status', status); if (competencia) q.set('competencia', competencia); if (unidade_id) q.set('unidade_id', unidade_id);
    return req('GET', `/api/expectativas${q.toString() ? `?${q}` : ''}`);
  },
  enviarLembrete: (id, body) => req('POST', `/api/expectativas/${id}/lembrete`, body || {}),
  cancelarExpectativa: (id, motivo) => req('POST', `/api/expectativas/${id}/cancelar`, { motivo }),
  // V232/O4: preview cadência + métricas agregadas
  previewCadencia: (body) => req('POST', '/api/expectativas/preview-cadencia', body),
  metricasExpectativas: (unidadeId) => req('GET', `/api/expectativas/metricas${unidadeId ? `?unidade_id=${unidadeId}` : ''}`),
  converterManual: (id, body) => req('POST', `/api/expectativas/${id}/converter-manual`, body),
  // notificacoes
  notificacoes: ({ naoLidasApenas = false } = {}) => req('GET', `/api/notificacoes${naoLidasApenas ? '?nao_lidas=1' : ''}`),
  marcarLida: (id) => req('POST', `/api/notificacoes/${id}/ler`),
  marcarTodasLidas: () => req('POST', '/api/notificacoes/ler-todas'),
  // metricas
  metricas: ({ competencia } = {}) => req('GET', `/api/metricas${competencia ? `?competencia=${competencia}` : ''}`),
  // fornecedores (cadastro/aprovacao)
  cadastrarFornecedor: (body) => req('POST', '/api/fornecedores/cadastrar', body, { authenticated: false }),
  cadastrarFornecedorExterno: (body) => req('POST', '/api/fornecedores/externo', body),
  fornecedoresPendentes: () => req('GET', '/api/fornecedores/pendentes'),
  aprovarFornecedor: (id, nome_contato) => req('POST', `/api/fornecedores/${id}/aprovar`, { nome_contato }),
  rejeitarFornecedor: (id, motivo) => req('POST', `/api/fornecedores/${id}/rejeitar`, { motivo }),
  // auditoria
  auditoria: (entidade, entidadeId) => req('GET', `/api/auditoria?entidade=${entidade}&entidade_id=${entidadeId}`),
  auditoriaSistema: ({ entidade, acao, usuario_id, dias, desde, ate, q: qs, limit, offset } = {}) => {
    const q = new URLSearchParams();
    if (entidade) q.set('entidade', entidade);
    if (acao) q.set('acao', acao);
    if (usuario_id) q.set('usuario_id', usuario_id);
    if (dias) q.set('dias', dias);
    if (desde) q.set('desde', desde);
    if (ate) q.set('ate', ate);
    if (qs) q.set('q', qs);
    if (limit) q.set('limit', limit);
    if (offset) q.set('offset', offset);
    return req('GET', `/api/auditoria/sistema${q.toString() ? `?${q}` : ''}`);
  },
  // CRUD unidades
  unidadesTodas: () => req('GET', '/api/unidades?todas=1', null, { authenticated: false }),
  criarUnidade: (body) => req('POST', '/api/unidades', body),
  atualizarUnidade: (id, body) => req('PUT', `/api/unidades/${id}`, body),
  ativarUnidade: (id) => req('POST', `/api/unidades/${id}/ativar`),
  desativarUnidade: (id) => req('POST', `/api/unidades/${id}/desativar`),
  detalheUnidade: (id) => req('GET', `/api/unidades/${id}/detalhe`),
  atividadeUnidade: (id, limit = 15) => req('GET', `/api/unidades/${id}/atividade?limit=${limit}`),
  serieUnidade: (id, periodos = 6, granularidade = 'week') => req('GET', `/api/unidades/${id}/serie?periodos=${periodos}&granularidade=${granularidade}`),
  serieGlobal: (periodos = 6, granularidade = 'week') => req('GET', `/api/metricas/serie-global?periodos=${periodos}&granularidade=${granularidade}`),
  atividadeGlobal: (limit = 15) => req('GET', `/api/metricas/atividade-global?limit=${limit}`),
  detalheFornecedor: (id) => req('GET', `/api/fornecedores/${id}/detalhe`),
  // CRUD usuarios
  listarUsuarios: ({ papel, unidade_id } = {}) => {
    const q = new URLSearchParams(); if (papel) q.set('papel', papel); if (unidade_id) q.set('unidade_id', unidade_id);
    return req('GET', `/api/usuarios${q.toString() ? `?${q}` : ''}`);
  },
  criarUsuario: (body) => req('POST', '/api/usuarios', body),
  atualizarUsuario: (id, body) => req('PUT', `/api/usuarios/${id}`, body),
  resetarSenhaUsuario: (id, novaSenha) => req('POST', `/api/usuarios/${id}/resetar-senha`, { nova_senha: novaSenha || null }),
  alterarMinhaSenha: (senhaAtual, novaSenha) => req('POST', '/api/me/senha', { senha_atual: senhaAtual, nova_senha: novaSenha }),
  atualizarMeuFornecedor: (body) => req('PUT', '/api/me/fornecedor', body),
  // emails simulados (admin only)
  listarEmails: ({ destinatario, tipo, limit, offset } = {}) => {
    const q = new URLSearchParams();
    if (destinatario) q.set('destinatario', destinatario);
    if (tipo) q.set('tipo', tipo);
    if (limit) q.set('limit', limit);
    if (offset) q.set('offset', offset);
    return req('GET', `/api/emails${q.toString() ? `?${q}` : ''}`);
  },
  obterEmail: (id) => req('GET', `/api/emails/${id}`),
  // bulk approval
  aprovarEnviosLote: (ids) => req('POST', '/api/envios/bulk/aprovar', { ids }),
  consultaPublicaProtocolo: (proto) => req('GET', `/api/envios/protocolo/${encodeURIComponent(proto)}`, null, { authenticated: false }),
  // V224: download documento. Não usa window.open (não passa Bearer token →
  // retorna 'Token ausente'). Faz fetch autenticado, vira blob, click sintético.
  downloadDocumento: async (envioId, docId) => {
    const t = getToken();
    if (!t) { handleUnauthorized(401); throw new Error('Sessão expirada'); }
    const r = await fetch(`/api/envios/${envioId}/documentos/${docId}/download`, {
      headers: { Authorization: `Bearer ${t}` }
    });
    if (!r.ok) {
      if (handleUnauthorized(r.status)) return;
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = m ? decodeURIComponent(m[1]) : `doc-${docId}`;
    document.body.appendChild(a); // Firefox precisa estar no DOM
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  },
  // upload (multipart, escapa do JSON helper)
  uploadDocumento: async (envioId, arquivo, campo = 'anexo') => {
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    fd.append('campo', campo);
    const r = await fetch(`/api/envios/${envioId}/documentos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (!r.ok) {
      if (handleUnauthorized(r.status)) return;
      const err = new Error((json && json.error) || `HTTP ${r.status}`);
      err.status = r.status; throw err;
    }
    return json;
  },
  // perfil do usuario
  obterMeuPerfil: () => req('GET', '/api/me'),
  atualizarMeuPerfil: (body) => req('PATCH', '/api/me', body),
  // anotacoes
  anotarDocumento: (envioId, docId, body) => req('POST', `/api/envios/${envioId}/documentos/${docId}/anotacao`, body),
  // encaminhar para FESF Sede
  encaminharSede: (envioId, motivo) => req('POST', `/api/envios/${envioId}/encaminhar-sede`, { motivo }),
  // revogar link publico
  revogarLink: (id) => req('DELETE', `/api/links/${id}`),
  // solicitar reenvio de documento
  solicitarReenvio: (envioId, body) => req('POST', `/api/envios/${envioId}/solicitar-reenvio`, body),
  // V228/O3.2: listar reenvios solicitados de um envio (operador/admin/fornecedor)
  listarReenvios: (envioId) => req('GET', `/api/envios/${envioId}/reenvios`),
  // pagamento estruturado (alem do simples marcarPago)
  marcarPagoEstruturado: (envioId, body) => req('POST', `/api/envios/${envioId}/marcar-pago`, body),
  // engajamento do fornecedor (inadimplente, etc.)
  atualizarEngajamentoFornecedor: (id, status, motivo) => req('PATCH', `/api/fornecedores/${id}/engajamento`, { status, motivo }),
  // configuracoes globais
  obterConfiguracoes: () => req('GET', '/api/configuracoes'),
  salvarConfiguracoes: (body) => req('PUT', '/api/configuracoes', body),
  // V214: SMTP config + envio real
  obterSmtp:   () => req('GET', '/api/admin/smtp'),
  salvarSmtp:  (body) => req('PUT', '/api/admin/smtp', body),
  testarSmtp:  (body) => req('POST', '/api/admin/smtp/test', body),
  smtpStatus:  () => req('GET', '/api/admin/smtp/status'),
  // recibo via protocolo (publico, sem auth)
  reciboPublico: (proto) => req('GET', `/api/envios/protocolo/${encodeURIComponent(proto)}/recibo`, null, { authenticated: false }),
  // marcar primeiro acesso como concluido
  concluirOnboarding: () => req('POST', '/api/me/concluir-onboarding'),
  // multi-unit operator
  unidadesOperador: (usuarioId) => req('GET', `/api/usuarios/${usuarioId}/unidades`),
  adicionarUnidadeOperador: (usuarioId, unidadeId) => req('POST', `/api/usuarios/${usuarioId}/unidades`, { unidade_id: unidadeId }),
  removerUnidadeOperador: (usuarioId, unidadeId) => req('DELETE', `/api/usuarios/${usuarioId}/unidades/${unidadeId}`),
  // bulk pendencias
  cancelarMultiplas: (ids, motivo) => req('POST', '/api/expectativas/bulk/cancelar', { ids, motivo }),
  // Preferências de notificação (server-side, sincroniza entre dispositivos)
  obterNotifPrefs: () => req('GET', '/api/me/notif-prefs'),
  salvarNotifPrefs: (prefs) => req('PUT', '/api/me/notif-prefs', { prefs }),
  // LGPD Art. 18 VI: direito ao esquecimento — anonimiza dados pessoais
  anonimizarMeusDados: (motivo) => req('DELETE', '/api/me/dados-pessoais', { confirmacao: 'ANONIMIZAR_DADOS', motivo }),
  // LGPD: fornecedor exporta próprios dados (Art. 18)
  baixarMeusDados: async () => {
    const r = await fetch('/api/me/dados-pessoais', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) { if (handleUnauthorized(r.status)) return; throw new Error('HTTP ' + r.status); }
    const blob = await r.blob();
    // V211: anexa ao DOM + revoga URL (mesmo padrao de baixarBackup)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meus-dados-fesf-${new Date().toISOString().substring(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  // admin backup
  baixarBackup: async () => {
    const r = await fetch('/api/admin/backup', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) { if (handleUnauthorized(r.status)) return; throw new Error('HTTP ' + r.status); }
    const blob = await r.blob();
    // V211: anexa ao DOM (Firefox exige p/ a.click() funcionar) + revoga URL (anti-leak)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fesf-backup-${new Date().toISOString().substring(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  // upload comprovante para um pagamento
  uploadComprovantePagamento: async (envioId, arquivo) => {
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    fd.append('campo', 'comprovante_pagamento');
    const r = await fetch(`/api/envios/${envioId}/documentos`, {
      method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd,
    });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    if (!r.ok) { if (handleUnauthorized(r.status)) return; const err = new Error((json && json.error) || `HTTP ${r.status}`); err.status = r.status; throw err; }
    return json;
  },
  // ---- documentos fixos do fornecedor ----
  listarDocsFixos: (fornecedorId) => req("GET", `/api/fornecedores/${fornecedorId}/documentos-fixos`),
  deletarDocFixo: (fornecedorId, docId) => req("DELETE", `/api/fornecedores/${fornecedorId}/documentos-fixos/${docId}`),
  downloadDocFixo: (fornecedorId, docId) => `/api/fornecedores/${fornecedorId}/documentos-fixos/${docId}/download`,
  // ---- alertas de certidões ----
  certidoesAlertas: () => req("GET", "/api/admin/certidoes-alertas"),
};

// =====================================================================
// UI helpers
// =====================================================================
export function brl(centavos) {
  if (centavos == null) return '—';
  return 'R$ ' + (Number(centavos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function dataBR(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}
/**
 * V238: helper centralizado para formatar status/origem em label amigável.
 * Resolve C2/R2/RP1/RP2 — strings raw "em analise" / "link publico" em 4 telas.
 * Uso: statusLabel('em_analise') => 'Em análise'
 *      statusLabel('link_publico') => 'Link público'
 * Se a chave não for conhecida, devolve a string capitalizada substituindo _ por espaço.
 */
const STATUS_LABELS = {
  // envio.status
  em_analise:           'Em análise',
  'em analise':         'Em análise',
  aprovado:             'Aprovado',
  rejeitado:            'Rejeitado',
  aguardando_ret:       'Aguardando retificação',
  aguardando_retificacao: 'Aguardando retificação',
  aguardando_pagamento: 'Aguardando pagamento',
  pago:                 'Pago',
  encaminhado_sede:     'Encaminhado à FESF Sede',
  // origens
  portal:               'Portal (fornecedor logado)',
  link_publico:         'Link público',
  'link publico':       'Link público',
  manual:               'Lançamento manual',
  // tipo de fornecedor
  com_portal:           'Portal próprio',
  externo_pj:           'Externo PJ',
  externo_pf:           'Externo PF',
  // papel de usuario
  admin_fesf:           'Admin FESF',
  operador_unidade:     'Operador',
  fornecedor:           'Fornecedor',
  // status expectativa
  pendente:             'Pendente',
  ok_recebida:          'Recebida',
  recebida:             'Recebida',
  atrasada:             'Atrasada',
  cancelada:            'Cancelada',
  // tipos de email
  novo_envio:           'Novo envio',
  envio_aprovado:       'Envio aprovado',
  envio_rejeitado:      'Envio rejeitado',
  lembrete_enviado:     'Lembrete enviado',
  pendencia_sem_resposta: 'Pendência sem resposta',
  pendencia_atrasada:   'Pendência atrasada',
  sistema:              'Sistema',
  // ações de auditoria
  criado_portal:        'criado (portal)',
  criado_link_publico:  'criado (link público)',
  criado_manual:        'criado (manual)',
  retificacao_solicitada: 'retificação solicitada',
  retificado:           'retificado',
  marcado_pago:         'marcado pago',
  documento_anexado:    'documento anexado',
  fornecedor_aprovado:  'fornecedor aprovado',
  fornecedor_rejeitado: 'fornecedor rejeitado',
  expectativa_criada:   'expectativa criada',
  link_publico_revogado: 'link público revogado',
  // validade de certidões
  ok:                   'Válida',
  alerta:               'A vencer',
  vencido:              'VENCIDA',
  pendente_validacao:   'Aguardando validação',
};
export function statusLabel(s) {
  if (!s) return '—';
  const k = String(s).toLowerCase().trim();
  if (STATUS_LABELS[k]) return STATUS_LABELS[k];
  // Fallback: capitalize + replace _ por espaço
  const t = k.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
/**
 * Formata respostas do formulario (state.data) em HTML legivel.
 * Identifica chaves q1_xxx, traduz nomes comuns, oculta campos internos.
 */
export function formatarRespostasForm(formData) {
  if (!formData || typeof formData !== 'object') return '<div class="muted">Sem dados do formulário.</div>';
  // Labels comuns dos formularios FESF
  const LABELS = {
    q1_nomeFornecedor: 'Razão social do fornecedor',
    q1_nomeRepresentante: 'Nome do representante',
    q2_cnpj: 'CNPJ',
    q2_cpf: 'CPF',
    q3_valor: 'Valor total',
    q3_valorTotalServico: 'Valor total do serviço',
    q3_valorTotalInsumos: 'Valor total dos insumos',
    q3_valorTotal: 'Valor total',
    q4_descricao: 'Descrição',
    q4_descricaoServico: 'Descrição do serviço',
    q4_descricaoInsumos: 'Descrição dos insumos',
    q5_competencia: 'Competência',
    q5_nfNumero: 'Número da NF',
    q5_numeroNF: 'Número da NF',
    q6_dataEmissaoNF: 'Data de emissão NF',
    q6_periodoExecucao: 'Período de execução',
    q7_responsavelTecnico: 'Responsável técnico',
    q8_observacoes: 'Observações',
    q10_nfNumero: 'Número da NF',
    q10_numeroNF: 'Número da NF',
    valorCentavos: 'Valor (centavos)',
    numeroNF: 'Número NF',
    descricao: 'Descrição',
  };
  // Campos internos a OCULTAR
  const HIDE = new Set(['seed', 'files_meta', 'modalidade_codigo', 'campos_revisados', 'observacao', 'dadosSubmetente', 'valorCentavos', 'numeroNF', 'descricao', 'valor_centavos', 'numero_nf', 'motivo', 'editado_por']);
  const entries = Object.entries(formData).filter(([k, v]) => {
    if (HIDE.has(k)) return false;
    if (v == null || v === '') return false;
    if (typeof v === 'object') return false; // oculta nested
    return true;
  });
  if (entries.length === 0) return '<div class="muted">Sem respostas registradas no formulário.</div>';
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;font-size:13px">
    ${entries.map(([k, v]) => {
      const label = LABELS[k] || k.replace(/^q\d+_/, '').replace(/_/g, ' ');
      const val = typeof v === 'string' ? v : String(v);
      return `<div style="padding:6px 0;border-bottom:1px dotted var(--border)"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-weight:600">${label}</div><div style="margin-top:2px">${val}</div></div>`;
    }).join('')}
  </div>`;
}

// Mapa de secoes esperadas em cada formulario (FESF)
// Cada secao agrupa campos por faixa de q-number
const SECOES_FORM = [
  { num: 1, titulo: 'Dados Gerais do Serviço e do Fornecedor', faixa: [0, 7],
    labels: { q0_nomeRespondente: 'Nome do respondente', q1_nomeFornecedor: 'Nome do Fornecedor', q2_cnpj: 'CNPJ', q3_valor: 'Valor Total do Serviço', q3_valorTotalServico: 'Valor Total do Serviço', q3_valorTotalInsumos: 'Valor Total dos Insumos', q4_descricao: 'Descrição', q4_descricaoServico: 'Descrição do Serviço', q4_descricaoInsumos: 'Descrição dos Insumos', q5_competencia: 'Mês/Ano de Referência', q6_email: 'E-mail para contato', q7_telefone: 'Telefone' } },
  { num: 2, titulo: 'Nota Fiscal e Documentação da Empresa', faixa: [8, 14],
    labels: { q8_notaFiscalPdf: 'NF em PDF', q9_notaFiscalXml: 'NF em XML', q10_nfNumero: 'Número da NF', q10_numeroNF: 'Número da NF', q11_dataEmissao: 'Data de Emissão', q12_contratoSocial: 'Contrato Social', q13_idRepresentante: 'ID do Representante', q14_nomeRepresentante: 'Nome do Representante' } },
  { num: 3, titulo: 'Certidões e Regularidade Fiscal', faixa: [15, 19],
    labels: { q15_certidaoFederal: 'Certidão Federal', q16_certidaoEstadual: 'Certidão Estadual', q17_certidaoMunicipal: 'Certidão Municipal', q18_cndt: 'CNDT', q19_crfFgts: 'CRF/FGTS' } },
  { num: 4, titulo: 'Documentos de Terceirização de Mão de Obra', faixa: [20, 27],
    labels: { q20_folha: 'Folha de pagamento', q21_compFgts: 'Comprovante FGTS', q22_compInss: 'Comprovante INSS', q23_compDarf: 'Comprovante DARF', q24_compPis: 'Comprovante PIS', q25_compCofins: 'Comprovante COFINS', q26_planilha: 'Planilha medição', q27_evidencia: 'Relatório evidência' } },
  { num: 5, titulo: 'Benefícios Opcionais', faixa: [28, 30],
    labels: { q28_seguroVida: 'Seguro de vida', q29_planoSaude: 'Plano de saúde', q30_planoOdonto: 'Plano odontológico' } },
  { num: 6, titulo: 'Documentos Comprobatórios e Proposta Comercial', faixa: [31, 36],
    labels: { q31_relatorioFgts: 'Relatório FGTS', q32_relatorioInss: 'Relatório INSS', q33_propostaComercial: 'Proposta Comercial', q34_aditivos: 'Aditivos contratuais', q35_planilhaMedicao: 'Planilha de Medição', q36_evidencia: 'Relatório de Evidência' } },
  { num: 7, titulo: 'Observações e Anexos Complementares', faixa: [37, 50],
    labels: { q37_observacoes: 'Observações', q38_anexos: 'Anexos complementares', q39_justificativas: 'Justificativas', q40_declaracoes: 'Declarações' } },
];

/**
 * Renderiza respostas do form ORGANIZADAS POR SECAO como o mockup.
 * Usa SECOES_FORM para agrupar por faixa de q-number.
 * Aceita opcionalmente anotacoes do operador para marcar status por campo.
 */
export function formatarRespostasFormSecoes(formData, anotacoes = [], documentos = [], envioId = null) {
  if (!formData || typeof formData !== 'object') return '<div class="muted">Sem dados do formulário.</div>';

  const HIDE = new Set(['seed', 'files_meta', 'modalidade_codigo', 'campos_revisados', 'observacao', 'dadosSubmetente', 'valorCentavos', 'numeroNF', 'descricao', 'valor_centavos', 'numero_nf', 'motivo', 'editado_por']);
  const anotMap = Object.fromEntries((anotacoes || []).map(a => [a.campo, a]));
  const DOC_LINK_MAP = { q10_nfNumero:['q8_nfPdf','q9_nfXml'], q10_numeroNF:['q8_nfPdf','q9_nfXml'],
    q11_dataEmissao:['q8_nfPdf','q9_nfXml'], q3_valor:['q8_nfPdf'],
    q3_valorTotalServico:['q8_nfPdf'], q3_valorTotalInsumos:['q8_nfPdf'], q2_cnpj:['q14_cnpj'] };
  const docPorCampo = {};
  for (const doc of (documentos || [])) { if (!docPorCampo[doc.campo]) docPorCampo[doc.campo] = doc; }

  // distribui campos do formData pelas secoes
  const camposPorSecao = SECOES_FORM.map(s => ({ ...s, campos: [] }));
  const naoCategorizados = [];

  for (const [k, v] of Object.entries(formData)) {
    if (HIDE.has(k)) continue;
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    // Extrai q-number
    const m = k.match(/^q(\d+)_/);
    if (!m) { naoCategorizados.push([k, v]); continue; }
    const qn = Number(m[1]);
    const sec = camposPorSecao.find(s => qn >= s.faixa[0] && qn <= s.faixa[1]);
    if (sec) sec.campos.push([k, v, qn]);
    else naoCategorizados.push([k, v]);
  }

  const renderField = (k, v, qn) => {
    const sec = camposPorSecao.find(s => qn !== undefined && qn >= s.faixa[0] && qn <= s.faixa[1]);
    const label = (sec && sec.labels[k]) || k.replace(/^q\d+_/, '').replace(/_/g, ' ');
    const an = anotMap[k];
    const status = an ? an.status : null;
    const statusBadge = status === 'verificado' ? '<span class="ano-badge ok" title="Verificado">✓</span>' :
                        status === 'duvida' ? '<span class="ano-badge dub" title="Em duvida">?</span>' :
                        status === 'problema' ? '<span class="ano-badge prob" title="Problema">!</span>' : '';
    // V304: observação visivelmente destacada — é onde o operador deixa comentários
    const obs = an && an.observacao ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(91,84,153,0.05);border-left:3px solid var(--primary);border-radius:0 6px 6px 0;font-size:12.5px;color:var(--text);line-height:1.45"><span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-weight:600;display:block;margin-bottom:2px">💬 observação</span>${an.observacao}</div>` : '';
    const labelEsc = String(label || k).replace(/"/g, '&quot;');
    const acoes = `<div class="ano-btns" style="display:flex;gap:3px"><button class="mini-btn ok" data-anotar="${k}" data-label="${labelEsc}" data-status="verificado" title="Marcar verificado">✓</button><button class="mini-btn dub" data-anotar="${k}" data-label="${labelEsc}" data-status="duvida" title="Em dúvida">?</button><button class="mini-btn prob" data-anotar="${k}" data-label="${labelEsc}" data-status="problema" title="Marcar problema">!</button></div>`;
    // V300: formatação inteligente — se o campo é monetário, formatar como BRL
    let valorRender = v;
    const klow = String(k).toLowerCase();
    if ((klow.includes('valor') && klow.includes('centavo')) || klow === 'valorcentavos') {
      const n = Number(v);
      if (Number.isFinite(n)) valorRender = brl(n);
    } else if (klow.startsWith('valor') || klow.includes('preco')) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) valorRender = brl(n);
    }
    let docLinkHtml = '';
    if (envioId && DOC_LINK_MAP[k]) {
      const docsRel = DOC_LINK_MAP[k].map(c => docPorCampo[c]).filter(Boolean);
      if (docsRel.length) { docLinkHtml = docsRel.map(d => {
        const ext = (d.nome_original||'').split('.').pop().toUpperCase();
        const nomeEsc = (d.nome_original||'').replace(/'/g,"\'");
        const mimeEsc = (d.mime_type||'application/octet-stream').replace(/'/g,"\'");
        return `<button type='button' onclick="visualizar(${envioId},${d.id},'${nomeEsc}','${mimeEsc}')" style='display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--primary);background:transparent;color:var(--primary);cursor:pointer;white-space:nowrap;margin-top:6px;margin-right:4px;font-weight:600'>👁 Ver ${ext}</button>`;
      }).join(''); }
    }
    return `<div class="form-readout-field" data-campo="${k}" style="padding:10px 0;border-bottom:1px dotted var(--border)">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span style="font-family:ui-monospace,monospace;background:rgba(91,84,153,.08);color:var(--primary-2);padding:1px 5px;border-radius:3px;font-size:10px">${qn != null ? qn : '—'}</span><span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-weight:600;flex:1">${label}</span>${statusBadge}${acoes}</div>
      <div style="margin-top:4px;font-size:13.5px">${valorRender}</div>
      ${docLinkHtml}
      ${obs}
    </div>`;
  };

  let html = '<style>.ano-badge{display:inline-flex;width:18px;height:18px;border-radius:50%;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff}.ano-badge.ok{background:var(--accent)}.ano-badge.dub{background:var(--warning)}.ano-badge.prob{background:var(--danger)}.mini-btn{width:22px;height:22px;border-radius:4px;font-size:11px;font-weight:700;padding:0;border:1px solid var(--border);cursor:pointer;background:#fff;color:var(--text-3)}.mini-btn:hover{transform:scale(1.1)}.mini-btn.ok:hover{background:var(--accent);color:#fff;border-color:var(--accent)}.mini-btn.dub:hover{background:var(--warning);color:#fff;border-color:var(--warning)}.mini-btn.prob:hover{background:var(--danger);color:#fff;border-color:var(--danger)}</style>';

  for (const sec of camposPorSecao) {
    if (sec.campos.length === 0) continue;
    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:14px;overflow:hidden">
      <div style="padding:12px 18px;background:var(--surface-2);display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--border)">
        <span style="width:26px;height:26px;border-radius:50%;background:var(--primary);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${sec.num}</span>
        <h4 style="margin:0;flex:1;font-size:13.5px">${sec.titulo}</h4>
        <span style="font-size:11.5px;color:var(--muted)">${sec.campos.length} campo(s)</span>
      </div>
      <div style="padding:8px 18px;display:grid;grid-template-columns:1fr 1fr;gap:0 18px">
        ${sec.campos.sort((a,b)=>a[2]-b[2]).map(([k,v,qn]) => renderField(k,v,qn)).join('')}
      </div>
    </div>`;
  }
  if (naoCategorizados.length > 0) {
    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:14px;padding:12px 18px">
      <h4 style="margin:0 0 8px;font-size:13px">Outros campos</h4>
      ${naoCategorizados.map(([k,v]) => renderField(k, v)).join('')}
    </div>`;
  }
  return html;
}

// V288: toast com slide-in da direita + ícone por tipo + sombra forte + auto-dismiss suave
export function toast(msg, tipo = 'info') {
  const el = document.getElementById('toast') || (() => {
    const e = document.createElement('div');
    e.id = 'toast';
    e.style.cssText = 'position:fixed;bottom:28px;right:28px;color:#fff;padding:14px 20px 14px 18px;border-radius:10px;font-size:14px;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.25), 0 2px 6px rgba(0,0,0,.12);z-index:10000;opacity:0;transform:translateX(20px);transition:all .25s cubic-bezier(.16,.84,.44,1);max-width:380px;display:flex;align-items:center;gap:10px;line-height:1.4;';
    document.body.appendChild(e); return e;
  })();
  const icones = { erro: '⚠', sucesso: '✓', info: 'ℹ' };
  const cores = { erro: '#b22828', sucesso: '#2f7d5c', info: '#1c1c1c' };
  el.innerHTML = `<span style="font-size:16px;font-weight:700;flex-shrink:0">${icones[tipo] || icones.info}</span><span>${msg}</span>`;
  el.style.background = cores[tipo] || cores.info;
  el.style.opacity = '1';
  el.style.transform = 'translateX(0)';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; }, 3200);
}
export function requireSession(papelEsperado) {
  const u = getUsuario();
  if (!u) { location.href = '/app/login.html'; return null; }
  if (papelEsperado && u.papel !== papelEsperado && u.papel !== 'admin_fesf') {
    location.href = '/app/login.html'; return null;
  }
  return u;
}


// =====================================================================
// System banner — exibe aviso global do admin em todas as páginas
// Auto-injetado quando este módulo é carregado. Banner dismiss via localStorage.
// =====================================================================
(async function injetarBanner() {
  if (typeof document === 'undefined') return;
  try {
    const r = await fetch('/api/system-banner');
    const { banner } = await r.json();
    if (!banner || !banner.texto) return;
    // Banner dismissed?
    const k = `banner_dismissed_${banner.texto.substring(0, 50)}`;
    if (localStorage.getItem(k) === '1') return;
    const cores = {
      info: { bg: '#e3f0ff', fg: '#0066cc', icon: 'ℹ' },
      warn: { bg: '#fff4d6', fg: '#a06800', icon: '⚠' },
      danger: { bg: '#ffd6d6', fg: '#b22828', icon: '⛔' },
    };
    const c = cores[banner.severidade] || cores.info;
    const div = document.createElement('div');
    div.id = 'system-banner';
    div.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;background:${c.bg};color:${c.fg};padding:10px 18px;display:flex;justify-content:space-between;align-items:center;gap:14px;font-size:13.5px;font-weight:500;box-shadow:0 1px 4px rgba(0,0,0,.08);border-bottom:1px solid ${c.fg}40`;
    div.innerHTML = `<span><strong style="margin-right:8px">${c.icon}</strong>${banner.texto}${banner.expira_em ? ` <span style="opacity:.7;font-weight:400;font-size:12px">· até ${new Date(banner.expira_em).toLocaleString('pt-BR')}</span>` : ''}</span><button style="background:transparent;border:1px solid ${c.fg};color:${c.fg};padding:3px 10px;font-size:12px;border-radius:4px;cursor:pointer">Dispensar</button>`;
    div.querySelector('button').addEventListener('click', () => {
      localStorage.setItem(k, '1');
      div.remove();
      document.body.style.paddingTop = '';
    });
    document.body.appendChild(div);
    // ajusta padding-top do body para não cobrir conteúdo
    requestAnimationFrame(() => {
      document.body.style.paddingTop = div.offsetHeight + 'px';
    });
  } catch {}
})();
