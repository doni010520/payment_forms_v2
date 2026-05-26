# Auditoria UI — Checklist tela-a-tela

> Cada elemento interativo de cada tela precisa: (a) ter handler que existe, (b) chamar endpoint que responde, (c) tratar erro de forma visível ao usuário.
> Status: ✅ ok · ⚠️ funciona com ressalva · ❌ quebrado · ⬜ pendente auditoria

## Fluxo fornecedor (Cenários 1 e 2)

### login.html ✅ (V207)
| # | Elemento | Status | Notas |
|---|---|---|---|
| 1 | Toggle Mostrar/Ocultar senha | ✅ | OK |
| 2 | 4 contas de demonstração (auto-preenche) | ✅ | todas válidas (login ok) |
| 3 | Submit form → routing por papel | ✅ | OK |
| 4 | Link "Esqueci minha senha" → senha.html | ✅ | 200 |
| 5 | Link "Cadastre-se" → cadastro.html | ✅ | 200 |
| 6 | Link "Consultar protocolo" → consulta.html | ✅ | 200 |
| 7 | Link "Como funciona" → onboarding.html | ✅ | 200 |
| ~~8~~ | ~~Checkbox "Lembrar-me"~~ | ❌→🗑️ | V207: era declarado mas nunca lido. **Removido** (JWT 8h é suficiente) |
| ~~9~~ | ~~Links "Privacidade" / "Suporte" (footer)~~ | ❌→🗑️ | V207: apontavam para `#`. **Removidos** (substituídos por "Consulta pública") |

### portal.html ✅ (V207)
- ✅ Topnav (tabs Meus envios / Pendências / Meu perfil), sino, logout, avatar — todos OK
- ✅ Notificações: lista, marca lida, marcar todas lidas, polling 30s — OK
- ✅ KPIs (total, em análise, aguard.ret, aprovados) — OK
- ✅ Listagem `/api/envios` com filtros status + unidade — OK
- ✅ Modal de detalhes: versões, documentos, comentários, auditoria, baixar doc, abrir retificação — OK
- ✅ Modal retificação: form, criar nova versão — OK
- ✅ Perfil: carregar + salvar (email/telefone/fantasia) — OK
- ⚠️→✅ **Alterar senha**: V207 fix — agora salva `novo_token` retornado pelo `/api/me/senha` (V198) em `setSession()`, impedindo que próxima ação dê 401
- ✅ "Próximos vencimentos" (expectativas) — OK
- ✅ Recibo abre em nova aba (já beneficiado do V206)

### portal-novo.html ✅ (V207)
- ✅ Voltar ao portal
- ✅ 6 cards de modalidade (codigoToForm mapeia todos)
- ✅ Lista de unidades dinâmica
- ✅ Seletor de competência (12 meses)
- ✅ Abrir formulário → constrói URL para `/formulario-hcc*.html` (validado: todas 6 servem 200)
- ✅ Voltar entre passos (1→2→3)

### publico.html ✅ (V207)
- ✅ Lookup do token via `api.lookupLink`
- ✅ Estados loading/erro/form (mostrados condicionalmente)
- ✅ Resolve form correto pelo `modalidade_codigo`
- ✅ Mensagens de erro específicas (ja_utilizado vs outros)

### sucesso.html ✅ (V207)
- ✅ Renderiza resumo do envio + protocolo + steps + respostas form
- ✅ Link recibo escolhe modo (id se logado, protocolo se anônimo)
- ⚠️→✅ V207 fix: botão "📋 Acompanhar no portal" escondido para anônimos (Cenário 2) — caia em login sem ação
- ✅ Link consulta sempre visível

### recibo.html ✅ (V206)
| # | Elemento | Ação | Status | Notas |
|---|---|---|---|---|
| 1 | `🖨 Imprimir / Salvar PDF` | `window.print()` | ✅ | nativo |
| 2 | `← Voltar` | `voltarInteligente()` | ✅ | V206: era `history.back()` que falhava ao abrir em nova aba; agora tenta fechar aba (window.opener) → senão volta → senão navega segundo papel (fornecedor→portal, op/admin→painel, anônimo→consulta) |

### consulta.html ✅ (V207)
- ✅ Submit busca protocolo via API
- ✅ Renderiza dados em sucesso
- ⚠️→✅ V207 fix: adicionado **botão "🖨 Ver recibo oficial"** no resultado — usuário sai do estado "encontrou mas e agora?"
- ⚠️→✅ V207 fix: mensagem de erro diferencia 404 ("não encontrado") de outros erros (rede/rate-limit), antes sempre dizia "Protocolo não encontrado" mesmo em falhas técnicas
- ✅ Link "Voltar ao login"

## Análise do envio (operador/admin)
### envio.html ✅ (V208)
- ✅ Topnav adapta por papel (fornecedor→portal, admin→admin/painel/unidades, operador→painel)
- ✅ Back-link aponta para tela apropriada
- ✅ Modal pagamento estruturado (TED, banco, data, valor, observação, comprovante via upload)
- ✅ Ações: aprovar (com confirmação se há problemas), solicitar retificação, rejeitar, encaminhar sede, marcar pago, recibo
- ✅ Anotar campo, anotar documento (verificado/dúvida/problema), solicitar reenvio por documento
- ✅ Modal preview de documento via fetch+Blob URL (resolve auth bearer pra img/pdf inline)
- ✅ Comentários com auto-refresh
- ⚠️→✅ V208 fix: `acaoEnviarRet` redirecionava fornecedor pro portal sem dizer qual envio. Agora passa `?retificar=ID` e portal abre o modal automaticamente

### painel.html ✅ (V208)
- ✅ Topnav, sino notificações (polling 30s), avatar, logout
- ✅ Tab "Envios" com filtros origem/status, bulk actions (aprovar lote, solicitar retificação lote)
- ✅ Tab "Pendências" com expectativas, bulk cancelar antigas (>30d), bulk lembrar atrasadas
- ✅ Tab "Links públicos" com criar/listar/revogar/copiar URL
- ✅ Tab "Fornecedores" (operador): listar com filtro, lançar manual direto
- ✅ Tab "Lançar" explicando caminho padrão + 3 vias de exceção (com modais)
- ✅ Modal detalhe com Aprovar/Rejeitar/Solicitar-ret/Pagar/Recibo
- ❌→✅ **V208 fix CRÍTICO**: botão "Convidar cadastrado" (caminho padrão recomendado!) chamava `abrirModal('modal-convite')` mas **esse modal não existia**. Clica e nada acontece. Redirecionado para `modal-expectativa` (semântica idêntica: registra expectativa pro fornecedor cadastrado, ele recebe notif)
- ❌→✅ **V208 fix**: barra de bulk-actions tinha `style="display:none; ... display:flex; ..."` — propriedade CSS duplicada fazia a barra **sempre visível** mesmo sem nada selecionado. Removido o segundo `display:flex`
- ❌→✅ **V208 fix funcional**: modal de pagamento (admin) chamava `marcarPago(id, observacao)` — versão simples sem TED/banco/comprovante, causando perda de dados estruturados. Substituído por link "💰 Registrar pagamento (estruturado) →" que abre `envio.html` com o modal completo. Função `window.marcarPago` morta removida

## Admin operacional
### admin.html ✅ (V209)
- ✅ Topnav com 12 links, tabs Dashboard/Pendentes
- ✅ Sino notificações + polling 30s (lista não-clicável para marcar lida — operador usa "marcar todas")
- ✅ Filtro competência + KPIs + barras (unidade/origem/modalidade/status)
- ✅ Aprovar/rejeitar fornecedor pendente com senha temporária no alert
- Sem bugs encontrados nesta tela

### admin-pagamentos.html ✅ (V209)
- ✅ Lista envios em status aprovado, total acumulado, seleção, bulk-pay
- ⚠️→✅ V209 fix: botão "Marcar selecionados como pagos" não deixava claro que perdia dados estruturados (TED/banco/comprovante). Renomeado para "Marcar lote como pagos (sem dados estruturados)" com tooltip
- ⚠️→✅ V209 fix: coluna "Ver" só abria envio. Renomeada para "💰 Registrar →" com label/cor sucesso indicando que é o caminho para pagamento estruturado

### admin-fornecedores.html ✅ (V209)
- ✅ Lista com filtros tipo + engajamento + busca local em razao/CNPJ
- ✅ Toggle engajamento via prompt (1/2/3 + justificativa obrigatória para inadimplente)
- ❌→✅ V209 fix: `<a class="button">Detalhe</a>` — **classe `.button` não existe no CSS**, ficava como link sem estilo. Trocado para `<button onclick=...>`

### admin-fornecedor.html ✅ (V209)
- ✅ Dados cadastrais, KPIs, unidades, origem, envios recentes, expectativas, comentários
- ❌→✅ **BUG CRÍTICO V209**: linha 144 lia `a.auditoria` mas endpoint retorna `{ trilha: [...] }` → **a trilha de auditoria do fornecedor NUNCA aparecia** (sempre "Sem eventos registrados"). Corrigido aceitando ambas chaves
- ⚠️→✅ V209: topnav não tinha o link "API" (outras admin têm 11 abas, essa tinha 10). Adicionado para consistência
- ⚠️→✅ V209: "Voltar" rígido para `/admin.html` mesmo quando admin veio de `/admin-fornecedores.html`. Redirecionado para a lista de fornecedores (origem mais provável)

### Bug colateral também corrigido — admin-unidade.html
- ❌→✅ V209: mesmo bug `a.auditoria` em vez de `a.trilha` — trilha da unidade também nunca aparecia. Corrigido.

### Bug colateral cosmético — sucesso.html
- ⚠️→✅ V209: `<a class="btn">` e `<a class="btn primary">` em `.actions-bar` — classes `.btn` / `.primary` não tinham estilo visual (background, border, hover). Adicionados estilos no `.actions-bar a, .actions-bar button` para botões com cor e estado hover.

## Admin cadastros
### admin-unidades.html ✅ (V210)
- ✅ KPIs (ativas/inativas/envios/movimento), CRUD modal, ativar/desativar
- ✅ Editar abre modal preenchido (com escape dos quotes)
- ⚠️→✅ V210: topnav faltava link **Pagamentos** (só tinha 10 abas em vez de 11)

### admin-unidade.html ✅ (V210, complementa V209)
- ✅ KPIs, distribuição por origem, operadores, fornecedores_count, expectativas
- ✅ Trilha de alterações (corrigido em V209)
- ⚠️→✅ V210: topnav faltava link **API** (só 10 abas)
- ⚠️→✅ V210: protocolos na tabela "Últimos envios" não eram clicáveis. Adicionado link para `/app/envio.html?id=${e.id}`

### admin-usuarios.html ✅ (V210)
- ✅ Filtros papel + unidade, KPIs por papel, listagem completa
- ✅ Reset senha gera nova + alert com senha temporária
- ✅ Ativar/desativar
- ✅ Modal "Unidades extras do operador" (V24/V154): adicionar/remover unidades secundárias
- ✅ Modal "Novo usuário" com select de papel + condicional de unidade
- ⚠️→✅ V210: select `us-unidade` não tinha `required` → submit com operador sem unidade gerava 500. Agora obriga.

### admin-config.html ✅ (V210)
- ✅ Lê configurações persistidas (cadencia/sla/bloqueio_inadimplente)
- ✅ Salvar cadência de lembretes (antes + depois)
- ✅ Salvar SLA (aprovação/pagamento) + checkbox bloqueio
- ✅ Forçar escalonamento (POST /api/expectativas/escalonar)
- ✅ Listagem de modalidades (read-only)
- ⚠️→✅ V210 (mesmo bug do V207 portal): handler de "Alterar senha" não usava `novo_token` → após V198 revogar a sessão, próxima ação do admin daria 401 silencioso. Corrigido com `setSession({ token: novo_token })`

### Bug colateral também corrigido — admin-api.html
- ⚠️→✅ V210: topnav só tinha 3 abas (Dashboard, Status, Configurações), faltando 8! Padronizado com as 11 abas do resto.

## Admin observabilidade
### admin-auditoria.html ✅ (V211)
- ✅ Filtros (entidade, ação, período, usuário, busca), listagem paginada
- ✅ Carregar mais (offset/limit)
- ✅→⬆️ V211: adicionado botão "⬇ CSV" usando endpoint V205 (`/api/auditoria/sistema.csv`) — antes a UI não expunha o export. Reutiliza os filtros aplicados. Mensagem específica quando X-Truncated.

### admin-emails.html ✅ (V211)
- ✅ Lista de e-mails com filtros (destinatário, tipo) e abrir modal com corpo
- ❌→✅ V211: filtro destinatário disparava request **a cada keystroke** (sem debounce) — saturava o backend. Adicionado debounce de 350ms.
- ✅→⬆️ V211: adicionado botão "⬇ CSV" usando endpoint V204 — antes a UI não usava.

### admin-status.html ✅ (V211)
- ✅ KPIs (status, uptime, db, versão), grids (cenários, status, alertas), contagens
- ✅ Auto-refresh 10s + bypass quando document.hidden
- ✅ Backup JSON via `api.baixarBackup`
- ⚠️→✅ V211: botão "🔧 Modo manutenção" tinha label **estático** — admin não sabia se estava LIGADO ou DESLIGADO antes de clicar. Agora reflete estado real ao carregar e troca cor (vermelho quando ON).

### admin-relatorios.html ✅ (V211)
- ✅ KPIs, SLA bars, série semanal, distribuição por hora (heatmap simples), unidade/origem/status/modalidade, pendências
- ✅ Botão "Imprimir / PDF" abre relatório-print.html em nova aba
- ❌→✅ V211: `window.exportar` fazia `a.click()` sem **anexar ao DOM** — falha em Firefox; sem `revokeObjectURL` — leak de memória. Corrigido (anexa, clica, remove, revoga após 1s).

### admin-api.html ✅ (V210)
- ✅ Topnav padronizado (V210)
- ✅ Lista de endpoints + botão de baixar openapi.json
- Sem bugs novos

### Bugs colaterais em api.js (V211)
- ❌→✅ `baixarBackup` (admin): mesmo bug de `a.click()` sem DOM/revoke → falha em Firefox + leak. Corrigido.
- ❌→✅ `baixarMeusDados` (LGPD portabilidade): mesmo bug. Corrigido — feature crítica de compliance precisava funcionar em todos os browsers.

## Acessórios
### perfil.html ✅ (V210)
- Auditado em V210 colateral · usa `novo_token` no alterar-senha

### notificacoes.html ✅ (V212)
- ✅ Filtros chip (todas, não-lidas, por categoria), lista, marcar lida em click, ir para destino
- ✅ Marcar todas como lidas
- ❌→✅ **BUG V212**: linha 157 usava `n.criado_em` (sem 'a') mas backend retorna `criada_em` → **TODAS as datas apareciam como "Invalid Date"**. Corrigido. (admin.html, portal.html, painel.html já usavam o nome certo — só essa tela tinha o typo)

### cadastro.html ✅ (V212)
- ✅ Form CRUD fornecedor, lista de unidades (checkboxes com toggle visual)
- ✅ Estado sucesso após cadastrar
- ⚠️→✅ V212: CNPJ aceitava qualquer caractere (só `maxlength="14"`). Agora tem `pattern="\d{14}"` + `inputmode="numeric"` + `title` explicativo. Submit já faz `.replace(/\D/g, '')` defensivamente caso usuário cole CNPJ formatado.

### onboarding.html ✅ (V212)
- ✅ Tela explicativa estática + handler `concluirOnboarding` quando `?primeiro=1`
- ✅ Roteamento por papel após concluir
- Sem bugs encontrados

### senha.html ✅ (V212)
- ✅ Form esqueci-minha-senha com sucesso state
- ✅ Link voltar ao login
- Sem bugs encontrados

### relatorio-print.html ✅ (V212)
- ✅ Tela print-optimized (CSS `@page`, oculta `.actions` ao imprimir)
- ✅ Botão imprimir nativo + voltar para admin-relatorios
- ✅ Renderiza todas as métricas em tabelas para fácil impressão
- Sem bugs encontrados
