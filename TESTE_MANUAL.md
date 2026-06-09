# Playbook de Teste Manual — Portal de Pagamentos FESF-SUS

> Como usar: abra `https://fesf-payment-forms.onrender.com` numa janela anônima e siga sessão por sessão. Marque cada item com **✓** se passou, **✕ <descrição do bug>** se falhou, **○** se quer pular. Quando terminar uma sessão, manda pro Claude os ✕ pra investigar.

**Versão alvo**: V306 (após redeploy do commit b2debbe)
**Data do teste**: ___________________
**Testador**: ___________________

---

## 🔧 Pré-requisitos

- [ ] Janela anônima/privada (sem cache antigo)
- [ ] DevTools aberto na aba Console + Network (pra capturar erros silenciosos)
- [ ] Credenciais à mão:
  - Admin: `maria.andrade@fesfsus.ba.gov.br` / `senha123`
  - Operador HECC: `carlos.souza@fesfsus.ba.gov.br` / `senha123`
  - Fornecedor: `contato@empresahosp.com.br` / `senha123`
- [ ] Conferir versão: `/api/version` deve retornar `"versao":"V306..."` ou `"V300-render"` se variável env do Render não foi atualizada

---

## 📍 Sessão 1 — Fluxos de Autenticação

### 1.1 Login
- [ ] Acessar `/app/login.html` direto → carrega sem erro no console
- [ ] Submeter com e-mail inválido (`xxx@xxx.com / errado`) → mensagem de erro clara, não trava
- [ ] Submeter com e-mail correto mas senha errada → mensagem de erro
- [ ] Login com Admin FESF → redireciona pra `/app/admin.html` (dashboard)
- [ ] Login com Operador HECC → redireciona pra `/app/painel.html`
- [ ] Login com Fornecedor → redireciona pra `/app/portal.html`
- [ ] Botão "Esqueci minha senha" leva pra `/app/esqueci-senha.html`

### 1.2 Esqueci a senha
- [ ] Preencher e-mail válido → mensagem de confirmação aparece
- [ ] Preencher e-mail inválido → mensagem genérica (não revelar se existe)
- [ ] Voltar pra login funciona

### 1.3 Logout
- [ ] Botão "Sair" no topnav funciona em todas as 3 personas
- [ ] Após logout, tentar acessar URL protegida (`/app/painel.html`) → redireciona pra login

### 1.4 Cadastro novo fornecedor (público)
- [ ] Acessar `/app/cadastro.html` (deveria estar linkado no login)
- [ ] Asterisco vermelho aparece em "Razão social" e "CNPJ"
- [ ] Submeter sem campos obrigatórios → não envia, mostra erros
- [ ] Submeter com CNPJ inválido → erro
- [ ] Submeter completo → mensagem de "cadastro pendente de aprovação"

---

## 📍 Sessão 2 — Visão Fornecedor logado (portal.html)

Login: `contato@empresahosp.com.br / senha123`

### 2.1 Portal — Visão geral
- [ ] Topnav mostra "Logado como Empresa Hospitalar Ltda."
- [ ] Lista de envios próprios (só os do fornecedor logado)
- [ ] Colunas: Protocolo, Modalidade, Competência, Status, Valor
- [ ] Cifrão (R$) e valor na mesma linha (sem quebra)

### 2.2 Iniciar novo envio
- [ ] Botão "+ Novo envio" abre seletor de unidade/modalidade
- [ ] Selecionar HECC + Indenizatório Mão de Obra → abre formulário
- [ ] URL tem `?modalidade=&unidade=&competencia=&...`
- [ ] Campo "Mês/Ano de Referência" (q5_competencia) está presente e obrigatório

### 2.3 Preenchimento do formulário
- [ ] Seção 1 — Dados Gerais: nome, CNPJ, valor, descrição, mês/ano, e-mail, telefone
- [ ] Máscara de CNPJ aplica automaticamente
- [ ] Máscara de valor (R$) aplica automaticamente
- [ ] Avançar pra Seção 2 sem preencher obrigatórios → mostra erro
- [ ] Voltar uma seção mantém o que foi digitado
- [ ] Indicador de progresso (X de Y preenchidos) atualiza

### 2.4 Upload de arquivos
- [ ] Drag-and-drop em campo de PDF funciona
- [ ] Clique no campo abre o seletor de arquivo
- [ ] Tipo errado (ex: .docx em campo PDF) → mostra erro
- [ ] Tamanho exibido em KB ou MB (auto-formato)
- [ ] Múltiplos arquivos no mesmo campo (quando permitido) funcionam
- [ ] Remover arquivo (X) funciona

### 2.5 Revisar e Enviar
- [ ] Última etapa mostra resumo agrupado por seção
- [ ] Botão "← Voltar" volta pra última seção, sem perder dados
- [ ] Botão "Enviar à FESF" — durante envio mostra "Enviando X arquivo(s)..."
- [ ] Após envio, redireciona pra `/app/sucesso.html?id=N`
- [ ] Tela de sucesso mostra protocolo + valor + fornecedor (não vazios)

### 2.6 Consulta pública por protocolo
- [ ] `/app/consulta.html` → digitar protocolo `HECC-XXXX-XXXX` → mostra status + dados
- [ ] Protocolo inexistente → mensagem clara de erro
- [ ] Layout limpo, sem cores fortes (otimizado pra impressão)

### 2.7 Recibo
- [ ] Botão "Imprimir recibo" abre `/app/recibo.html?id=N`
- [ ] Layout sem cores decorativas (preparado pra impressão)
- [ ] Timestamps consistentes (mesmo "criado em" no recibo e no envio)

---

## 📍 Sessão 3 — Link Público Anônimo (sem login)

Pré: logado como Admin FESF, gerar 2 links — um vinculado a fornecedor (ALFA) e outro genérico.

### 3.1 Gerar links no painel
- [ ] Aba "Links públicos" → botão "+ Gerar link"
- [ ] Modal abre. Como admin, mostra campo "Unidade" (selecionar HECC)
- [ ] Selecionar fornecedor ALFA, modalidade "Pagamento MOE", expira em 30 dias
- [ ] Submeter → URL gerada no `prompt()` (copiar)
- [ ] Repetir, sem selecionar fornecedor → gera link genérico (anônimo)

### 3.2 Abrir o link (janela anônima)
- [ ] URL `https://...onrender.com/app/publico.html?token=pub_...` carrega
- [ ] Mostra unidade + modalidade + fornecedor (se vinculado) ou "anônimo"
- [ ] Botão "Abrir formulário" leva pro `/formulario-hcc-pgto-mao-obra.html?...`

### 3.3 Preenchimento via link
- [ ] Banner topo mostra "Envio via link público" + sigla unidade
- [ ] NÃO há badge "Logado como X"
- [ ] Banner não mostra competência travada (deve ser preenchida via q5_competencia na seção 1)
- [ ] Botão "← portal" no topo (mesmo sem login)
- [ ] Preencher q5_competencia com mês passado (ex: 2026-04) — deve aceitar
- [ ] Preencher demais campos + uploads
- [ ] Enviar → tela de sucesso local mostra protocolo + valor + fornecedor (não vazios)

### 3.4 Tentar usar o mesmo link novamente
- [ ] Reabrir mesmo URL → se link era "uso único", deve dar erro "Link já foi utilizado"
- [ ] Se "uso múltiplo" com limite N, deve aceitar até N

### 3.5 Link expirado
- [ ] Admin: editar link e setar expira em data passada
- [ ] Reabrir o link no anônimo → erro "Link expirado"

### 3.6 Link revogado
- [ ] Admin: revogar link na aba Links públicos
- [ ] Reabrir o link → erro "Link revogado"

### 3.7 Rascunho do localStorage isolado
- [ ] Preencher 50% de um link, fechar aba sem enviar
- [ ] Reabrir o **mesmo** link → rascunho aparece restaurado
- [ ] Abrir um link **diferente** (outra modalidade/token) → começa do zero
- [ ] DevTools → Application → Local Storage → confirmar chaves `hcc_form_pagamento_v1_pub_<token24>` (não a antiga `hcc_form_pagamento_v1` única)

---

## 📍 Sessão 4 — Visão Operador (Carlos · HECC)

Login: `carlos.souza@fesfsus.ba.gov.br / senha123`

### 4.1 Painel — Topo
- [ ] Topnav: "Portal de Pagamentos · Painel da unidade HECC"
- [ ] Eyebrow: "HOSPITAL ESTADUAL COSTA DOS COQUEIROS · LAURO DE FREITAS"
- [ ] Pill: "● Visão: Operador HECC"
- [ ] Dropdown "Competências" populado com 13 meses
- [ ] Trocar competência → KPIs e tabela recarregam juntas
- [ ] "Todas competências" → KPI label muda pra "todas comp." e mostra tudo

### 4.2 KPIs
- [ ] 4 cards: Recebidos · Aguardando ret. · Pendências críticas · Aprovados (mês)
- [ ] Cifrão e valor sem quebra de linha
- [ ] Clicar nos KPIs leva pra views filtradas (em_analise, aguardando_ret, etc.)

### 4.3 Chart "Envios da unidade"
- [ ] Card "Envios da unidade" (sem "acumulado por semana")
- [ ] Toggle Dia · Semana · Mês funciona, re-renderiza imediatamente
- [ ] Defaults: 14 dias / 6 semanas / 6 meses
- [ ] Linhas dashed horizontais aparecem como referência
- [ ] Semanas/dias vazios aparecem com tracinho fino, não somem
- [ ] Tooltip ao passar mouse mostra breakdown por status
- [ ] Cores suaves (não saturadas)

### 4.4 Atividade recente
- [ ] Card "Atividade recente" lista últimas ações com nome/papel + protocolo
- [ ] Clicar num item abre o envio correspondente

### 4.5 Tabela "Envios recebidos"
- [ ] Filtros: Todas origens / Todos status / Competência
- [ ] Coluna FORNECEDOR mostra razão social OU "Nome submetido + pílula 'via link'"
- [ ] Coluna FORNECEDOR não mostra `—` (a menos que realmente sem dado)
- [ ] Coluna VALOR: R$ não quebra do número
- [ ] Coluna SLA mostra "X dias / Yd" com cor (verde/amarelo/vermelho)
- [ ] Botão "Ver" abre detalhe do envio em `/app/envio.html?id=N`
- [ ] Exportar CSV funciona

### 4.6 Detalhe do envio (envio.html)
- [ ] Cabeçalho: protocolo · razão social · CNPJ · descrição
- [ ] Se envio sem fornecedor cadastrado: "(sem cadastro)" + selo "via link público"
- [ ] DOCUMENTO: mostra CNPJ ou `—`, NUNCA `null`
- [ ] Trajetória do envio: marcos com timestamps
- [ ] Se status=aprovado, marco "Pago" mostra "⏳ aguardando FESF Sede"
- [ ] Card "🤖 X inconsistências detectadas" (se houver alertas de validação)
- [ ] Botões de ação:
  - Aprovar: solid verde (destaque)
  - Solicitar retificação: outline ambar
  - Rejeitar: outline vermelho
- [ ] Se status=aprovado (visão operador): banner verde "Aprovado pela unidade · Encaminhado pra FESF Sede"

### 4.7 Aba Formulário
- [ ] 5 KPIs: Verificados · Em dúvida · Problemas · Não revisados (sem o "Comentários")
- [ ] Cada campo mostra label do front + valor + status badge + botões ✓ ? !
- [ ] Clicar em ✓ abre modal `#modal-anotacao` com título "Anotar campo: <LABEL DO FRONT>" (não a variável `q1_...`)
- [ ] Modal: auto-focus no textarea, Ctrl+Enter salva, ESC cancela
- [ ] Observação aparece como card destacado abaixo do campo (borda lateral roxa, label "💬 OBSERVAÇÃO")
- [ ] Após marcar, **permanece na aba Formulário** (não volta pra Resumo)
- [ ] Mesmo padrão pros 6 campos da seção 1, depois testar 1-2 das outras seções

### 4.8 Aba Documentos
- [ ] Chips de tipo no topo: PDF, XML (cinza neutro com bolinha colorida — não bloco saturado)
- [ ] "X arquivo(s) · YY KB total" — sem notação científica (não `6.67e+156 KB`)
- [ ] Cada doc-card mostra: ícone tipo, nome, campo, tamanho, data, validade (se certidão)
- [ ] Botões ✓ ? ! pequenos outline (não sólidos)
- [ ] Card de alertas (se validacao_json tem `alertas[]`): inline com severidade colorida
- [ ] Botões "👁 Visualizar" + "⬇ Baixar" + "↻ Reenvio"
- [ ] Visualizar PDF → abre modal `#modal-preview` com iframe blob
- [ ] Visualizar XML → abre o conteúdo
- [ ] Após marcar doc → continua na aba Documentos

### 4.9 Aba Comentários
- [ ] Lista de comentários (op + fornecedor)
- [ ] Formulário pra adicionar comentário
- [ ] Submeter funciona

### 4.10 Aba Auditoria
- [ ] Linha do tempo de ações (criado_link_publico, documento_anexado, etc.)
- [ ] Cada linha mostra: ícone de ação, usuário/papel, timestamp
- [ ] Hover roxo sutil

### 4.11 Aprovar envio
- [ ] Clicar "✓ Aprovar envio" → confirma e processa
- [ ] Status muda pra "aprovado", trajetória avança
- [ ] Banner verde aparece pra operador
- [ ] **Admin FESF recebe notificação no sino** (verificar logando como Maria)
- [ ] **Admin FESF recebe e-mail** (verificar em `/api/emails` ou via login admin)
  - ⚠️ Em sandbox Resend, só `sgihecc@gmail.com` recebe de verdade — outros endereços ficam `erro_envio: 'Resend 403'`

### 4.12 Solicitar retificação
- [ ] Clicar "⚠ Solicitar retificação" → abre prompt
- [ ] Submeter sem motivo (ou <5 chars) → erro
- [ ] Submeter com motivo válido → status muda pra `aguardando_ret`
- [ ] Fornecedor recebe notificação (logar como contato@empresahosp.com.br pra confirmar)

### 4.13 Rejeitar envio
- [ ] Clicar "✕ Rejeitar" → abre prompt motivo
- [ ] Submeter → status `rejeitado`, trajetória interrompida
- [ ] Fornecedor recebe notificação

### 4.14 Encaminhar para FESF Sede
- [ ] Clicar "▲ Encaminhar para FESF Sede" → abre prompt
- [ ] Submeter motivo → admin FESF recebe notif

### 4.15 Imprimir recibo
- [ ] Clicar "🖨 Imprimir recibo" → abre `/app/recibo.html?id=N`
- [ ] Print preview do navegador: sem cores fortes, layout funcional

### 4.16 Outras abas do painel
- [ ] **Pendências** — lista expectativas, atrasadas em destaque
- [ ] **Fornecedores** — lista fornecedores que enviam pra HECC, com filtro
- [ ] **Links públicos** — lista links, status (ativo/expirado/revogado), botão revogar
- [ ] **Novo lançamento** (manual) — formulário compacto, sem fornecedor pré-selecionado

---

## 📍 Sessão 5 — Visão Admin FESF (Maria · Sede)

Login: `maria.andrade@fesfsus.ba.gov.br / senha123`

### 5.1 Dashboard inicial (`/app/admin.html`)
- [ ] Topnav: "Portal de Pagamentos · Análise de envio" (ou similar)
- [ ] KPIs: Em análise · Aguardando ret. · Aprovados (mês) · Pendências críticas
- [ ] KPIs clicáveis levam pra views filtradas
- [ ] Menu "Pendentes" vai pra `/app/painel.html` (fila de análise), NÃO pra aprovação de fornecedor

### 5.2 Painel admin (`/app/painel.html`)
- [ ] Topnav: "Portal de Pagamentos · Painel FESF Sede"
- [ ] Eyebrow: "FUNDAÇÃO ESTATAL SAÚDE DA FAMÍLIA · SEDE"
- [ ] Pill: "● Visão: FESF Sede · todas as unidades"
- [ ] Título: "Análise de envios" (não "Painel da unidade")
- [ ] Botão "← Dashboard" como primeiro item na barra de abas

### 5.3 KPIs e tabela de envios
- [ ] KPIs agregam **todas as unidades** (não só HECC)
- [ ] Tabela lista envios de várias siglas (HECC, MRC, HMI, etc.) se houver
- [ ] Filtros funcionam globalmente

### 5.4 Chart "Envios FESF · todas as unidades"
- [ ] Título do chart muda pra "Envios FESF · todas as unidades"
- [ ] Toggle Dia/Semana/Mês funciona com dados agregados
- [ ] Não fica escondido (era bug antigo: chart sumia pra admin)

### 5.5 Atividade recente agregada
- [ ] Card mostra ações de várias unidades

### 5.6 Aprovar envio (admin)
- [ ] Abrir envio em `em_analise` → mesmo flow do operador (Aprovar / Ret. / Rejeitar)
- [ ] Após aprovar, **botão "💰 Marcar como pago" aparece** (operador não tinha)

### 5.7 Marcar como pago
- [ ] Clicar "💰 Marcar como pago" → abre modal estruturado
- [ ] Campos: nº TED, banco pagador, data efetiva, valor (opcional), observação, comprovante (PDF/imagem opcional)
- [ ] Validar campos obrigatórios → erro se faltar
- [ ] Submeter → status muda pra `pago`, trajetória completa
- [ ] Fornecedor recebe notificação e e-mail

### 5.8 Administração — Unidades (`/app/admin-unidades.html`)
- [ ] Lista 8 unidades (HECC, MRC, HMI, etc.)
- [ ] Coluna "Total movimentado" sem quebra do R$
- [ ] Clicar uma unidade abre detalhe (`/app/admin-unidade.html?id=N`)
- [ ] Detalhe mostra envios recentes da unidade, operadores, fornecedores vinculados

### 5.9 Administração — Fornecedores
- [ ] Lista fornecedores com filtro
- [ ] Aprovar/rejeitar fornecedores pendentes
- [ ] Editar dados de fornecedor existente

### 5.10 Administração — Modalidades
- [ ] Lista 6 modalidades
- [ ] `documentos_esperados` parsed corretamente

### 5.11 Administração — E-mails (`/app/admin-emails.html`)
- [ ] Lista e-mails com chip de tipo + filtros
- [ ] Cada linha tem indicador: enviado_real ou erro_envio
- [ ] **Verificar e-mails recentes**: deveriam ser `enviado_real=true` se destinatário=`sgihecc@gmail.com`, `erro_envio: 'Resend 403...'` se outro
- [ ] Endpoint debug: `GET /api/admin/smtp/debug-env` retorna se RESEND_API_KEY está presente

### 5.12 Administração — Auditoria, Status, API
- [ ] `/app/admin-auditoria.html` — log com filtros
- [ ] `/app/admin-status.html` — saúde do sistema (DB, storage, e-mail)
- [ ] `/app/admin-api.html` — endpoints documentados (OpenAPI 3.0)
- [ ] `/app/admin-certidoes.html` — alertas de certidões vencidas/a vencer

### 5.13 Pagamentos (`/app/admin-pagamentos.html`)
- [ ] Lista de pagamentos a processar
- [ ] R$ sem quebra de linha
- [ ] "Marcar lote como..." se houver função de batch

---

## 📍 Sessão 6 — Edge cases e Regressão

Pegadinhas conhecidas que JÁ deram bug e foram corrigidas. Verificar que continuam OK.

### 6.1 Path com `C:` no Windows
- [ ] Upload de arquivo no Windows com path contendo `:` → deve funcionar (não é mais um problema desde V300)

### 6.2 Cifrão e valor
- [ ] Em qualquer tabela, R$ + valor SEMPRE na mesma linha
- [ ] Funciona em janela estreita (resize do browser)

### 6.3 Preview de PDF
- [ ] Abrir um PDF via modal de preview → carrega (não fica branco)
- [ ] Console: sem mensagem CSP bloqueando blob

### 6.4 Link público + competência editável
- [ ] Fornecedor preenche q5_competencia com 2026-03 (3 meses atrás)
- [ ] Envio gravado com competência=2026-03 (não a do mês corrente)

### 6.5 Localstorage isolado entre forms
- [ ] Preencher form de "Indenizatório MOE" via link A → fechar
- [ ] Abrir link B (modalidade diferente, ex: "Pagamento Serviços") → começa em branco

### 6.6 Atalhos de teclado
- [ ] Estando em `/app/envio.html`: Ctrl+Shift+R → recarrega página (não dispara "solicitar retificação")
- [ ] Tecla `A` solta → dispara aprovação (com confirmação)
- [ ] Tecla `R` solta → dispara retificação
- [ ] Tecla `?` → abre modal de hotkeys

### 6.7 Validação automática (V305)
- [ ] Subir um XML de NF-e com CNPJ diferente do fornecedor
- [ ] Aguardar ~10s
- [ ] Refresh do envio → ver alerta "CNPJ_DIVERGENTE" no doc-card
- [ ] Card "🤖 X inconsistências detectadas" aparece no resumo
- [ ] Sino do operador HECC tem notificação

### 6.8 Admin sem unidade não esconde gráfico
- [ ] Logado como Maria → gráfico aparece (era bug antigo: sumia)

### 6.9 Coluna FORNECEDOR não fica `null`
- [ ] Envio criado via link público SEM fornecedor → coluna mostra nome submetido + pílula "via link"

---

## 📍 Sessão 7 — Performance, console limpo, UX

### 7.1 Console do navegador
- [ ] Navegar por TODAS as telas listadas — console deve ficar **limpo**, sem erros vermelhos
- [ ] Warnings amarelos aceitáveis se forem só sourcemap ou recursos externos

### 7.2 Network
- [ ] Conferir: nenhuma chamada retornando 500 em uso normal
- [ ] 401/403 só onde esperado (acesso indevido)
- [ ] 404 só em recursos opcionais (favicon, etc.)

### 7.3 Responsividade (rápido)
- [ ] Painel em 1024px de largura ainda funciona
- [ ] Em mobile (375px) — não obrigatório bonito, mas não quebrar

### 7.4 Cold start
- [ ] Acessar `/api/version` direto — primeira vez pode demorar (Render free tier)
- [ ] UptimeRobot pingando mantém quente

---

## 🏁 Encerramento

Quantos itens passaram: ____ / ____
Quantos bugs encontrados: ____

Manda pro Claude:
1. Lista dos itens com **✕** + descrição do bug
2. Screenshot se houve algo visual
3. Mensagem do console se houve erro JS
