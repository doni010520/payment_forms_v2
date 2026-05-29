/* =====================================================================
 * Form Adapter · FESF-SUS
 * Liga os formulários reais (formulario-hcc*.html) ao backend.
 *
 * Estratégia: monkey-patch da função finalizeSubmission() que existe
 * em cada form. Quando o usuário clica "Enviar formulário", o submit
 * vai ao backend ao invés de salvar localmente.
 *
 * Configuração via URL params:
 *   ?modalidade=indenizatorio_moe  (codigo da modalidade)
 *   ?unidade=1                     (id ou sigla)
 *   ?competencia=2026-12
 *   ?public_token=pub_xxx          (se for via link publico)
 * ===================================================================== */
(function () {
  'use strict';

  // ------------------- Config & helpers -------------------
  const params = new URLSearchParams(location.search);
  const cfg = {
    modalidadeCodigo: params.get('modalidade') || 'indenizatorio_moe',
    unidadeIdent: params.get('unidade') || null, // pode ser sigla ou id
    competencia: params.get('competencia') || formatDefaultCompetencia(),
    publicToken: params.get('public_token') || null,
  };

  function formatDefaultCompetencia() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function brlToCentavos(s) {
    if (!s) return 0;
    // aceita "1.234,56" ou "1234,56" ou "1234.56" ou "1234"
    const clean = String(s).replace(/[^\d,.-]/g, '');
    // se tem virgula, virgula = decimal
    if (clean.includes(',')) {
      const [intPart, decPart] = clean.split(',');
      return Math.round((Number(intPart.replace(/\./g, '')) + Number('0.' + (decPart || '0'))) * 100);
    }
    // sem virgula: pode ser numero inteiro ou decimal com ponto
    return Math.round(Number(clean.replace(/\./g, '')) * 100) || Math.round(Number(clean) * 100);
  }

  function getToken() {
    return localStorage.getItem('fesf_token');
  }
  function getUsuario() {
    try { return JSON.parse(localStorage.getItem('fesf_usuario') || 'null'); } catch { return null; }
  }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    const r = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (!r.ok) {
      const err = new Error((json && json.error) || `HTTP ${r.status}`);
      err.status = r.status; err.body = json; throw err;
    }
    return json;
  }

  // ------------------- Resolver modalidade/unidade -------------------
  let modalidades = null, unidades = null;
  async function resolveContext() {
    if (!modalidades) modalidades = (await fetch('/api/modalidades').then(r => r.json())).modalidades;
    if (!unidades)    unidades    = (await fetch('/api/unidades').then(r => r.json())).unidades;
    const modalidade = modalidades.find(m => m.codigo === cfg.modalidadeCodigo);
    let unidade = null;
    if (cfg.unidadeIdent) {
      unidade = unidades.find(u => String(u.id) === cfg.unidadeIdent) ||
                unidades.find(u => u.sigla === cfg.unidadeIdent);
    }
    return { modalidade, unidade };
  }

  // ------------------- Extracao dos dados do form -------------------
  function getStateData() {
    // O form usa window.state.data e window.state.files
    return (window.state && window.state.data) ? window.state.data : {};
  }
  function getStateFiles() {
    return (window.state && window.state.files) ? window.state.files : {};
  }

  // ------------------- V221: captura de Files reais -------------------
  // O formulário só guarda metadados em state.files. Aqui interceptamos
  // o evento `change` dos <input type="file"> (capture-phase, antes do
  // listener do form) para preservar o objeto File real em window._fesfFiles.
  // Mapeia por campo (input.id começa com "fld_" + nome do campo).
  // V299: SEMPRE reinicia ao montar — evita vazamento de arquivos entre
  // envios consecutivos na mesma sessão (bug reportado pelo usuário).
  window._fesfFiles = {};
  document.addEventListener('change', (e) => {
    const inp = e.target;
    if (!inp || inp.tagName !== 'INPUT' || inp.type !== 'file') return;
    const id = inp.id || '';
    const m = id.match(/^fld_(.+)$/);
    if (!m) return;
    const campo = m[1];
    const files = Array.from(inp.files || []);
    if (!files.length) return;
    // Acumula (modo multiple) ou substitui (single). Como nao sabemos qual e
    // a config, sempre acumulamos por nome — duplicatas pelo nome o backend
    // filtra via SHA256 (V25 hash dedup).
    if (!window._fesfFiles[campo]) window._fesfFiles[campo] = [];
    for (const f of files) {
      // Substitui se ja existe arquivo com mesmo nome
      window._fesfFiles[campo] = window._fesfFiles[campo].filter(x => x.name !== f.name);
      window._fesfFiles[campo].push(f);
    }
  }, true);
  // Drop tambem: capture phase pega antes do form
  document.addEventListener('drop', (e) => {
    // Procura input.file irmao do elemento dropável
    let el = e.target;
    while (el && el !== document) {
      const inp = el.querySelector && el.querySelector('input[type="file"][id^="fld_"]');
      if (inp) {
        const campo = inp.id.replace(/^fld_/, '');
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) {
          if (!window._fesfFiles[campo]) window._fesfFiles[campo] = [];
          for (const f of files) {
            window._fesfFiles[campo] = window._fesfFiles[campo].filter(x => x.name !== f.name);
            window._fesfFiles[campo].push(f);
          }
        }
        break;
      }
      el = el.parentNode;
    }
  }, true);

  function pickSummary(stateData) {
    // Diferentes formularios usam ids ligeiramente diferentes.
    // Tentamos varias possibilidades para valor, NF, descricao.
    const valor = stateData.q3_valor || stateData.q3_valorTotalServico ||
                  stateData.q3_valorTotalInsumos || stateData.q3_valorTotal || '';
    const nf = stateData.q10_nfNumero || stateData.q10_numeroNF ||
               stateData.q5_nfNumero || stateData.q5_numeroNF || '';
    const descricao = stateData.q4_descricaoServico || stateData.q4_descricaoInsumos ||
                      stateData.q4_descricao || stateData.q1_nomeFornecedor || '';
    return {
      valor_brl: valor,
      valor_centavos: brlToCentavos(valor),
      numero_nf: nf,
      descricao: descricao.toString().substring(0, 500),
    };
  }

  // ------------------- V221: Upload de arquivos -------------------
  async function uploadArquivo(envio, campo, file) {
    const fd = new FormData();
    fd.append('arquivo', file);
    fd.append('campo', campo);
    let url, headers = {};
    if (cfg.publicToken) {
      url = '/api/envios/publico/' + encodeURIComponent(cfg.publicToken) + '/' + envio.id + '/documentos';
    } else {
      const t = getToken();
      if (!t) throw new Error('Sem token para upload');
      url = '/api/envios/' + envio.id + '/documentos';
      headers.Authorization = 'Bearer ' + t;
    }
    const r = await fetch(url, { method: 'POST', headers, body: fd });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (!r.ok) {
      const e = new Error((json && json.error) || ('HTTP ' + r.status));
      e.status = r.status; throw e;
    }
    return json.documento;
  }

  // ------------------- Submit -------------------
  async function submitToBackend() {
    const stateData = getStateData();
    const stateFiles = getStateFiles();
    const { modalidade, unidade } = await resolveContext();

    if (!modalidade) {
      throw new Error('Modalidade nao reconhecida: ' + cfg.modalidadeCodigo);
    }

    const summary = pickSummary(stateData);
    // V300: complementos pendentes — campos que o fornecedor marcou para enviar depois
    const complementosPendentes = Array.isArray(stateData.complementos_pendentes)
      ? stateData.complementos_pendentes.filter(Boolean)
      : [];
    const fullDados = { ...stateData, files_meta: stateFiles, modalidade_codigo: cfg.modalidadeCodigo };

    // Competência: preferir o campo q5_competencia preenchido pelo usuário no formulário.
    // Cai pra cfg.competencia (URL) só se o campo não estiver preenchido.
    const competenciaFinal = stateData.q5_competencia || cfg.competencia;
    if (!competenciaFinal || !/^\d{4}-\d{2}$/.test(competenciaFinal)) {
      throw new Error('Preencha a Competência (mês/ano de referência) na Seção 1.');
    }

    let envio;
    if (cfg.publicToken) {
      // Submissao via link publico (anonimo)
      const r = await api('POST', `/api/envios/publico/${cfg.publicToken}`, {
        competencia: competenciaFinal,
        valor_centavos: summary.valor_centavos,
        numero_nf: summary.numero_nf,
        descricao: summary.descricao,
        submetente_nome: stateData.q1_nomeFornecedor || stateData.q1_nomeRepresentante || null,
        submetente_documento: stateData.q2_cnpj || stateData.q2_cpf || null,
        dados: fullDados,
        complementos_pendentes: complementosPendentes,
      });
      envio = r.envio;
    } else if (getToken()) {
      // Submissao como fornecedor logado
      const u = getUsuario();
      if (!unidade && !cfg.unidadeIdent) {
        throw new Error('Selecione uma unidade na URL ?unidade=SIGLA');
      }
      const unidadeId = unidade ? unidade.id : null;
      if (!unidadeId) throw new Error('Unidade nao resolvida');
      const r = await api('POST', '/api/envios/portal', {
        unidade_id: unidadeId,
        modalidade_id: modalidade.id,
        competencia: competenciaFinal,
        valor_centavos: summary.valor_centavos,
        numero_nf: summary.numero_nf,
        descricao: summary.descricao,
        dados: fullDados,
        complementos_pendentes: complementosPendentes,
      });
      envio = r.envio;
    } else {
      throw new Error('Sem token nem link publico — login necessario');
    }

    return envio;
  }

  // ------------------- Bridge: intercepta o click do botão Enviar -------------------
  // V220 fix: o monkey-patch antigo de window.finalizeSubmission não funcionava
  // porque o handler de click do botão (no formulário) chama finalizeSubmission()
  // direto (referência local da function declaration), nao window.finalizeSubmission.
  // Solução: clonamos o botão (perdendo handlers antigos) e instalamos nosso próprio
  // handler que faz validacao basica + POST ao backend.
  function installBridge() {
    const btn = document.getElementById('btnSubmit');
    if (!btn) {
      // formulário ainda nao montou — tenta de novo em 200ms
      setTimeout(installBridge, 200);
      return;
    }
    // Clone substitui — handlers antigos perdidos (intencional)
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', async (e) => {
      e.preventDefault();
      // Reaproveita validacao do form se disponivel
      if (typeof window.allRequiredFilled === 'function' && !window.allRequiredFilled()) {
        // Form mostra os erros sozinho via renderReview / setErr
        if (typeof window.renderReview === 'function') window.renderReview();
        return;
      }
      const txt = clone.textContent;
      clone.disabled = true;
      clone.textContent = 'Enviando ao FESF…';
      try {
        const envio = await submitToBackend();

        // V221: upload de arquivos REAL apos criar envio.
        // window._fesfFiles foi populado em capture-phase. Para cada campo,
        // intersectamos com state.files (filtro do form) por nome — assim
        // arquivos rejeitados pela validacao do form nao sao enviados.
        // V299: guarda STRICT — se aceitos[campo] for vazio/undefined, pula
        // o campo inteiro (evita vazamento de arquivos de envios anteriores
        // ainda presentes em window._fesfFiles).
        const filesPorCampo = window._fesfFiles || {};
        const aceitos = getStateFiles();
        const totais = Object.keys(filesPorCampo).reduce((a, k) => a + filesPorCampo[k].length, 0);
        const uploaded = []; const falhas = [];
        if (totais > 0) {
          clone.textContent = 'Enviando ' + totais + ' arquivo(s)…';
          for (const [campo, fileList] of Object.entries(filesPorCampo)) {
            // V299: se o usuário não anexou nada neste campo no envio atual, pula
            const aceitosCampo = aceitos[campo] || [];
            if (aceitosCampo.length === 0) continue;
            const aceitosNomes = aceitosCampo.map(f => f.name);
            for (const file of fileList) {
              // Só envia arquivos que estão na lista de aceitos do envio atual
              if (!aceitosNomes.includes(file.name)) continue;
              try {
                await uploadArquivo(envio, campo, file);
                uploaded.push({ campo, name: file.name });
              } catch (uerr) {
                falhas.push({ campo, name: file.name, erro: uerr.message });
                console.warn('[form-adapter] upload falhou:', campo, file.name, uerr);
              }
            }
          }
        }
        // V299: limpa cache de arquivos após upload completo. Próximo envio
        // começa com slate limpo — mesmo se usuário não recarregar a página.
        window._fesfFiles = {};

        // Snapshot dos dados do formulário ANTES do reset (necessário para popular a tela de sucesso)
        const snapData = (window.state && window.state.data) ? { ...window.state.data } : {};

        // V300: limpa o rascunho do formulário no localStorage para o próximo envio
        // não puxar dados antigos. (O form em si já limpa via STORAGE_KEY no seu próprio submit,
        // mas garantimos o reset em memória aqui pra próximo envio na mesma aba.)
        try {
          // Reset do estado em memória (se o usuário ficar na mesma aba)
          if (window.state) {
            window.state.data = {};
            window.state.files = {};
            if (window.state._submittedAt) delete window.state._submittedAt;
          }
        } catch {}

        // Se houve falha de upload, avisa o usuario (envio foi criado)
        if (falhas.length) {
          alert('Envio criado (protocolo ' + envio.protocolo + '), mas ' + falhas.length +
                ' arquivo(s) falharam ao subir:\n' +
                falhas.map(f => '• ' + f.name + ' (' + f.erro + ')').join('\n') +
                '\n\nEntre em contato com a unidade para reenviar.');
        }

        // V220: redireciona para sucesso.html SO se o usuario tiver token (cenario portal).
        // Para link publico (anonimo) sucesso.html quebra porque chama api.envio() autenticado —
        // entao usamos a view-success local do form, populando com o protocolo REAL do backend.
        if (getToken() && envio.id) {
          location.href = `/app/sucesso.html?id=${envio.id}`;
          return;
        }
        // Cenario publico: usa view-success local
        try {
          const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
          setText('protocolNum', envio.protocolo);
          setText('sentAt', new Date(envio.criado_em).toLocaleString('pt-BR'));
          // Usa o snapshot capturado ANTES do reset (window.state.data já foi zerado acima)
          const fornecedorNome = snapData.q1_nomeFornecedor || snapData.q1_nomeRepresentante || '—';
          const valorTxt = snapData.q3_valor || snapData.q3_valorTotalServico || snapData.q3_valorTotalInsumos || snapData.q3_valorTotal || '';
          setText('sentSupplier', fornecedorNome);
          setText('sentValue', valorTxt ? (valorTxt.toString().startsWith('R$') ? valorTxt : 'R$ ' + valorTxt) : '—');
          if (typeof window.showView === 'function') {
            window.showView('view-success');
          }
        } catch (uierr) {
          // fallback: mostra protocolo em alert se nao consegue popular UI
          alert('Envio recebido pela FESF!\n\nProtocolo: ' + envio.protocolo +
                '\n\nGuarde este número — você pode consultar em /app/consulta.html');
        }
      } catch (err) {
        const msg = err.message + (err.body ? '\n\n' + JSON.stringify(err.body) : '');
        alert('Não foi possível enviar à FESF: ' + msg);
        clone.disabled = false;
        clone.textContent = txt;
      }
    });
    console.log('[form-adapter] bridge instalado · modalidade=' + cfg.modalidadeCodigo + ' unidade=' + cfg.unidadeIdent + ' competencia=' + cfg.competencia);

    // Mostra contexto no topo da pagina (preenche um overlay informativo)
    showContextBanner();
  }

  function showContextBanner() {
    resolveContext().then(({ modalidade, unidade }) => {
      // Cria banner topo
      const b = document.createElement('div');
      b.id = 'fesf-context-banner';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#5B5499;color:#fff;padding:8px 16px;font-size:12.5px;z-index:1000;display:flex;align-items:center;gap:14px;font-family:-apple-system,sans-serif';
      const u = getUsuario();
      const quem = cfg.publicToken
        ? `Envio via link público <code style="background:rgba(255,255,255,.15);padding:1px 5px;border-radius:3px">${cfg.publicToken.substring(0,20)}…</code>`
        : (u ? `Logado como ${u.nome}` : 'Não autenticado');
      // V238 fix FH1: só renderiza o segmento "Unidade ..." se houver unidade real (evita "Unidade —" vazio quando admin testa o form sem unidade vinculada).
      const unidadeSigla = unidade ? unidade.sigla : cfg.unidadeIdent;
      const unidadeFrag = unidadeSigla ? `<span style="opacity:.8">· Unidade ${unidadeSigla}</span>` : '';
      // Banner só mostra competência quando ela vem fixa pela URL (fluxo logado/admin).
      // No fluxo de link público, a competência é o campo q5_competencia do próprio formulário.
      const competenciaFrag = params.get('competencia') ? `<span style="opacity:.8">· Competência ${cfg.competencia}</span>` : '';
      b.innerHTML = `
        <strong>FESF-SUS · ${modalidade ? modalidade.nome : cfg.modalidadeCodigo}</strong>
        ${unidadeFrag}
        ${competenciaFrag}
        <span style="flex:1"></span>
        <span style="opacity:.8">${quem}</span>
        <a href="/app/portal.html" style="color:#fff;text-decoration:underline">← portal</a>
      `;
      document.body.appendChild(b);
      // Empurra o conteudo pra baixo
      document.body.style.paddingTop = '36px';
    }).catch(e => console.warn(e));
  }

  // ============================================================
  // V300.1: pre-preenche campos FIXOS do fornecedor logado.
  // Dados que NÃO mudam entre envios — CNPJ, razão social, contatos.
  // ============================================================
  async function prefillFornecedorLogado() {
    if (!getToken()) return;
    let me;
    try { me = await api('GET', '/api/me'); } catch { return; }
    const u = me && me.usuario;
    if (!u || u.papel !== 'fornecedor' || !u.fornecedor_id) return;
    // V300.2: SEMPRE limpa o draft do localStorage ao montar o formulário.
    // Razão: cada NF/competência é uma submissão única — não cabe rascunho persistente.
    // Os campos FIXOS são repreenchidos abaixo via /api/me; variáveis ficam vazios.
    let tinhaDraft = false;
    try {
      const draftRaw = localStorage.getItem('hcc_form_pagamento_v1');
      if (draftRaw) {
        tinhaDraft = true;
        localStorage.removeItem('hcc_form_pagamento_v1');
        console.log('[form-adapter] draft anterior removido — novo envio começa limpo');
      }
    } catch {}

    const fixos = {
      q1_nomeFornecedor: u.fornecedor_razao_social || '',
      q2_cnpj:           u.fornecedor_documento || '',
      q6_email:          u.fornecedor_email || u.email || '',
      q7_telefone:       u.fornecedor_telefone || '',
    };

    // Aguarda renderização do formulário via MutationObserver.
    // O formulário HCC tem uma "view-cover" inicial — os campos só são renderizados
    // quando o usuário clica em "Iniciar preenchimento →". O observer dispara o
    // prefill exatamente quando os campos aparecem no DOM (sem polling, sem timeout fixo).
    const esperarFormularioRenderizado = () => new Promise(resolve => {
      // Caso 1: form já renderizado (refresh com state em form-view)
      if (document.getElementById('fld_q1_nomeFornecedor')) return resolve(true);
      // Caso 2: aguardar até aparecer (capa → form)
      const obs = new MutationObserver(() => {
        if (document.getElementById('fld_q1_nomeFornecedor')) {
          obs.disconnect();
          resolve(true);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      // safety: máx 5 minutos (caso o user nunca clique em iniciar, libera o observer)
      setTimeout(() => { obs.disconnect(); resolve(false); }, 5 * 60 * 1000);
    });

    const renderizou = await esperarFormularioRenderizado();
    if (!renderizou) {
      console.warn('[form-adapter] form não renderizou após 5min — prefill abortado');
      return;
    }
    // Pequena pausa para o renderer terminar de pintar todos os campos
    await new Promise(r => setTimeout(r, 100));

    // V300.2: se tinha draft, limpar os campos VARIÁVEIS que o renderer preencheu
    // do localStorage stale. Resetar window.state.data também para o submit não
    // mandar dados antigos.
    if (tinhaDraft) {
      const camposVariaveis = ['q3_valor', 'q4_descricao', 'q5_competencia', 'q10_nfNumero', 'q10_dataEmissao'];
      for (const c of camposVariaveis) {
        const el = document.getElementById('fld_' + c);
        if (el) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      // Reset agressivo do state em memória (mantém só os fixos)
      if (window.state && window.state.data) {
        const fixosKeys = ['q1_nomeFornecedor','q2_cnpj','q6_email','q7_telefone'];
        const novoData = {};
        for (const k of fixosKeys) {
          if (window.state.data[k]) novoData[k] = window.state.data[k];
        }
        window.state.data = novoData;
      }
      if (window.state && window.state.files) window.state.files = {};
      window._fesfFiles = {};
      console.log('[form-adapter] campos variáveis resetados (draft antigo descartado)');
    }

    // SEMPRE escreve com o valor do cadastro (autoridade do backend).
    // Dado fixo do cadastro vence sobre qualquer rascunho local.
    // Para CNPJ e telefone, o form aplica máscara visual após o prefill —
    // por isso comparamos apenas os dígitos para detectar "mesmo valor"
    // (evita retry infinito de algo que já está correto, só formatado).
    const soDigitos = s => String(s || '').replace(/D/g, '');
    const camposComMascara = new Set(['q2_cnpj', 'q7_telefone']);
    const aplicar = () => {
      let n = 0;
      for (const [campo, valor] of Object.entries(fixos)) {
        if (!valor) continue;
        const input = document.getElementById('fld_' + campo);
        if (!input) continue;
        // Comparação inteligente: para campos com máscara, compara só dígitos
        const jaIgual = camposComMascara.has(campo)
          ? soDigitos(input.value) === soDigitos(valor)
          : input.value === String(valor);
        if (jaIgual) continue;
        input.value = valor;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        n++;
      }
      return n;
    };

    const n1 = aplicar();
    if (n1 > 0) console.log('[form-adapter] pré-preenchidos ' + n1 + ' campo(s) fixo(s) do cadastro');

    // Retry após 500ms em caso de race com o renderer (formulário pode setar value tardiamente)
    setTimeout(() => {
      const n2 = aplicar();
      if (n2 > 0) console.log('[form-adapter] retry prefill: ' + n2 + ' campo(s) corrigido(s)');
    }, 500);
  }
  // Inicializa quando a pagina ja carregou (o form define finalizeSubmission no proprio script)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { installBridge(); prefillFornecedorLogado(); });
  } else {
    installBridge();
    prefillFornecedorLogado();
  }
})();
