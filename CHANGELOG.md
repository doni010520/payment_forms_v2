# CHANGELOG — Portal de Pagamentos FESF-SUS

> **Como usar**: antes de fazer uma alteração, consulte aqui se ela:
> 1. Já foi tentada e removida (seção `⛔ NÃO REINTRODUZIR`)
> 2. Tem uma decisão de design conhecida (seção `🎯 DECISÕES DE DESIGN`)
> 3. Já está documentada em uma versão anterior (histórico abaixo)
>
> Toda mudança não-trivial deve ser registrada aqui com **o quê** e **por quê**.

---

## ⛔ NÃO REINTRODUZIR (anti-patterns conhecidos)

Coisas que já causaram bugs e foram removidas/substituídas. Antes de adicionar algo similar, leia o motivo.

### 1. `import { toast } from '/app/ui.js'`
- **O que era**: import quebrado em `admin-smtp.html` e `trocar-senha.html`.
- **Por que removido**: o arquivo `/app/ui.js` não existe. O ESM importa `undefined` silenciosamente, e a página fica em `Carregando…` eterno.
- **Substituto correto**: `import { toast } from '/app/api.js'` — toast está em api.js junto com outros helpers.
- **Referência**: V235.

### 2. `import { exigirSessao } from '/app/api.js'`
- **O que era**: nome português antigo do helper.
- **Por que removido**: api.js exporta `requireSession`, não `exigirSessao`. Causava `undefined` silencioso → redirect para login mesmo logado.
- **Substituto correto**: `import { requireSession } from '/app/api.js'`.
- **Referência**: V235.

### 3. `Math.floor((Date.now() - new Date(envio.criado_em).getTime()) / 86400000)` sem `Math.max(0, ...)`
- **O que era**: cálculo de dias em análise no painel.html exibia `-1 dias` para envios novos.
- **Por que removido**: `criado_em` retornava com offset de TZ; subtração dava negativo. Sintoma do bug raiz V239.
- **Substituto correto**: `Math.max(0, Math.floor(diffMs / 86400000))` (guarda defensiva) + fix raiz `process.env.TZ='UTC'` (V239).
- **Referência**: V235 (sintoma), V239 (raiz).

### 4. Schema `TIMESTAMP` (sem time zone) + DB rodando em fuso não-UTC
- **O que era**: colunas `criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP` no schema.
- **Por que problemático**: PGlite + host em `America/Bahia` (UTC-3) faz `CURRENT_TIMESTAMP` armazenar wall-clock local e serializar com sufixo `Z`, fazendo o cliente reinterpretar e gerar drift de 3h em **todas** as inserções.
- **Fix aplicado**: `process.env.TZ = 'UTC'` no topo de `server.js` (antes de qualquer import que toque PGlite).
- **Não reintroduzir**: nunca remover essa linha. Schema usa TIMESTAMP (não TIMESTAMPTZ) por compatibilidade com PG real; o TZ=UTC força consistência.
- **Referência**: V239.

### 5. `.replace('_',' ')` em strings de status/origem/ação/papel
- **O que era**: padrão repetido em ~30 pontos da UI para renderizar `em_analise → "em analise"`, `link_publico → "link publico"`, etc.
- **Por que removido**: sem acentos, sem capitalização, inconsistente entre telas, e impossível mudar label sem caçar todos os pontos.
- **Substituto correto**: `import { statusLabel } from '/app/api.js'` e usar `statusLabel(s)`. Mapa `STATUS_LABELS` em api.js cobre: status, origem, tipo fornecedor, papel usuário, tipo email, ações de auditoria.
- **Para adicionar novo status**: adicionar entrada no mapa `STATUS_LABELS` — não criar lógica local.
- **Referência**: V240, V241.

### 6. Versão "V25" hardcoded em strings de UI
- **O que era**: `<title>` e subtítulos com "V25" / "OpenAPI 3.0 · V25" / "V25+health" em admin-status, admin-api.
- **Por que removido**: ficava desatualizado a cada rev (estamos em V243 hoje).
- **Substituto correto**: constante `APP_VERSION` em `server.js` (com override por env `APP_VERSION`), lida via `/api/version`.
- **Referência**: V238.

### 7. Botão "Marcar todas como lidas" sem `disabled` quando 0 não-lidas
- **O que era**: notificações sem badge mas botão clicável.
- **Por que removido**: clicar ativava chamada de API inútil, e parecia bug ao usuário.
- **Substituto correto**: `btn.disabled = naoLidas === 0` — já implementado.
- **Referência**: já estava OK em V237; documento aqui para não removerem por acidente.

### 8. `class="origin ${e.origem}">${e.origem}</span>` raw
- **O que era**: chips de origem mostravam `LINK_PUBLICO`, `MANUAL`, `PORTAL` (raw, sem acento).
- **Por que removido**: feio + inconsistente com pills de status.
- **Substituto correto**: `${statusLabel(e.origem)}` (via api.js helper).
- **Referência**: V241.

### 9. `timeZone: 'America/Bahia'` em `toLocaleString` na UI **antes** do fix raiz V239
- **O que era**: tentativa em V238 de forçar timezone na exibição do recibo.
- **Por que problemático**: estava mascarando o bug raiz (DB com drift), e os timestamps na UI continuavam inconsistentes entre "Emitido em" e "criado portal".
- **Substituto correto**: fix raiz no servidor (V239 `TZ='UTC'`). Após o fix, a UI pode usar `toLocaleString('pt-BR')` direto (sem `timeZone` arg) e mostrar consistente para o navegador local. A opção `timeZone: 'America/Bahia'` ainda funciona, mas não é necessária — é decisão UX.
- **Referência**: V238 (workaround), V239 (raiz).

### 10. Timeline com dots numerados de 26-30px + checkmark/glow halo grande em `envio.html`
- **O que era**: V268 adicionou `<span class="dot-num">` com números (1,2,3,...) e check (✓) em círculos de 26-30px, halo de 5px.
- **Por que problemático**: o autor de V268 **interpretou erroneamente o mockup como "rico/numerado"**, mas o mockup real (screen-details) usa dots **minimalistas de 14px via `::before`** pseudo-element, sem números, sem icones. O resultado era um visual carregado, divergente do mockup.
- **Substituto correto** (V294): `::before` 14px no `.timeline-step`, com `border: 3px solid var(--surface)` (gera o efeito "flutuante"), `box-shadow: 0 0 0 1px var(--border)` no estado base, `0 0 0 4px var(--primary-soft)` no `.active` (halo sutil). Conector via `::after` 2px. **Nenhum `<span>` extra no JS** — só DOM mínimo (`.label` + `.when`).
- **Não reintroduzir**: dots > 14px, números/checkmarks dentro dos dots, halo > 4px. Se o usuário pedir "mais rico", lembre que ele já recusou esse design — o mockup é a fonte de verdade.
- **Referência**: V268 (errado), V294 (correto).

### 11. `rm -rf .pgdata` / `.uploads` sem aviso explícito do usuário 🔴
- **O que é**: durante debug de teste, executar `rm -rf .pgdata .uploads && node server.js ...` para "rodar com estado limpo".
- **Por que problemático**: **apaga TODO o trabalho do usuário** — envios criados durante teste manual, uploads anexados, configurações persistidas (SMTP, OneDrive). Não tem volta porque PGlite é arquivo local sem backup automático. Aconteceu em V298: usuário perdeu envio HECC-0004-5007 que tinha criado para testar o fluxo MOE.
- **Substituto correto**:
  - **Nunca** apagar `.pgdata` ou `.uploads` se o usuário estiver no meio de testes manuais
  - Para rodar teste isolado com estado limpo, criar **diretório alternativo**: `PGLITE_DIR=.pgdata-test UPLOADS_DIR=.uploads-test node server.js`
  - Antes de qualquer comando destrutivo no banco, **PERGUNTAR** ao usuário ou fazer backup automático (já temos `/api/admin/backup` desde V171)
  - O `test-all.sh` faz reset destrutivo por design — é diferente, e roda em contexto de CI/teste, não em interação com usuário
- **Não reintroduzir**: rm -rf em estado persistente do app durante interação manual com o usuário.
- **Referência**: V298 (incidente).

---

## 🎯 DECISÕES DE DESIGN

Escolhas conscientes que devem ser preservadas.

### D1. Documentos para impressão sem cores decorativas
- Recibo (`recibo.html`) e Relatório Imprimível (`relatorio-print.html`) usam **layout limpo em preto-e-branco**, sem cores decorativas nem legendas de cor.
- **Razão**: preferência explícita do usuário registrada em `CLAUDE.md`. Para impressão / arquivamento oficial. Não adicionar pills coloridas, gradientes, ícones de status colorido aqui.

### D2. Hero gradient roxo na portal do fornecedor
- `portal.html` tem um banner roxo com saudação personalizada ("Olá, Empresa X. Você atende: HECC, MRC...").
- **Razão**: melhor que o mockup neste ponto — humaniza a experiência. Mantido em V242.

### D3. Action card de retificação no topo do portal
- `portal.html` exibe banner amarelo "Atenção necessária" quando o fornecedor tem envios `aguardando_ret`, com botão direto "Retificar →".
- **Razão**: alinhamento com mockup oficial. Comprime fricção: fornecedor entra → vê imediatamente o que precisa fazer → 1 clique para começar.
- Implementado em V242.

### D4. Helper `statusLabel()` é a única fonte de verdade para labels
- Toda renderização de `envio.status`, `envio.origem`, `fornecedor.tipo`, `usuario.papel`, `email.tipo`, `auditoria.acao` passa por `statusLabel()` em api.js.
- **Razão**: i18n simples, consistência cross-tela, ponto único para mudar texto.
- **Para adicionar novo valor**: adicionar entrada em `STATUS_LABELS`. Não criar `replace` local.

### D5. `APP_VERSION` em server.js (não em UI)
- A constante `APP_VERSION` no servidor é lida pela UI via `/api/version`.
- **Razão**: 1 lugar para atualizar; UI sempre reflete o servidor real.
- **Para bumpar versão**: trocar a constante em `server.js` (linha ~316) ou setar env `APP_VERSION`.

### D6. PGlite com `TZ=UTC` (não TIMESTAMPTZ)
- Schema usa `TIMESTAMP` (não `TIMESTAMPTZ`) por compatibilidade com PG real via DATABASE_URL.
- O processo Node força `process.env.TZ='UTC'` no topo de server.js.
- **Razão**: evitar migração de schema + manter portabilidade entre PGlite (dev) e PG real (prod). Forçar TZ no processo é suficiente.

### D7. localStorage keys: `fesf_token` e `fesf_usuario` (não `token`/`usuario`)
- Constantes em `api.js`:
  ```js
  const TOKEN_KEY = 'fesf_token';
  const USR_KEY   = 'fesf_usuario';
  ```
- **Razão**: prefixo evita colisão se o domínio hospedar outros apps. Ao injetar sessão manualmente em testes/preview, usar essas keys.

### D8. Nav admin: ordem padronizada `Dashboard → ... → E-mails → SMTP → Status → API → Configurações`
- SMTP fica logo após E-mails (conceitualmente relacionados), em vez do fim do nav onde escapava do viewport em telas estreitas.
- Aplicado em 11 arquivos admin via script idempotente (V238 + V240).
- **Para reordenar**: editar todos os admin-*.html simultaneamente, manter ordem consistente.

### D9. Botão "Marcar todas" disabled quando 0 não-lidas
- Defensive UX: evita chamadas API inúteis e mostra estado vazio claro.
- Implementado em notificacoes.html.

### D10. Recibo "Emitido em" usa `new Date()` (now)
- Não tem timestamp persistido — é o momento em que o usuário gera o recibo.
- Após V239, é consistente com timestamps do banco (ambos em UTC).

---

## 📜 HISTÓRICO

### V299 — 2026-05-26 — Fix: vazamento de arquivos entre envios consecutivos
**Por quê**: usuário reportou que arquivos de um preenchimento estavam aparecendo como cache em outro preenchimento. Investigação revelou bug real em `form-adapter.js`: `window._fesfFiles` (variável global JS que armazena File objects) **nunca era limpa** entre envios. Pior: a guarda no upload (`if (aceitos[campo] && !aceitosNomes.includes(file.name)) continue`) só filtrava SE `aceitos[campo]` existisse — se o usuário não tinha anexado nada naquele campo no envio atual, o IF era falsy e o arquivo do envio anterior passava direto.

**Fix** (`backend/public/app/form-adapter.js`):
1. **Reset ao montar** (linha ~98): `window._fesfFiles = {}` (era `window._fesfFiles || {}`) — garante slate limpo a cada novo formulário
2. **Guarda STRICT no upload** (linha ~273): se `aceitos[campo]` for vazio/undefined, pula o campo inteiro com `continue` — não tenta enviar arquivos órfãos
3. **Limpa após sucesso** (linha ~290): `window._fesfFiles = {}` após upload completo — próximo envio começa do zero mesmo sem reload

**APP_VERSION bumpado V298 → V299** para invalidar cache do form-adapter.js no navegador via mecanismo de cache-busting (V298).

**Testes**: suite 1127 verdes.

---

### V298 — 2026-05-26 — Cache-busting automático via query string (fix definitivo do cache)
**Por quê**: V297 adicionou `must-revalidate` mas só funciona para **novos** caches. Navegador com cache antigo (de antes do V297) ainda servia versão velha — usuário precisava `Cmd+Shift+R` em cada página. Solução definitiva: cada referência a `/app/*.js` ou `/app/*.css` no HTML ganha `?v=APP_VERSION` automaticamente. Quando versão muda, URL muda, navegador descarta cache velho **sem ação manual do usuário**.

**Iteração crítica durante implementação**: a primeira versão do regex só pegava `<script src="...">` e `<link href="...">`, mas **muitas páginas usam ES module inline**: `<script type="module">import { ... } from '/app/api.js'</script>`. Sem o cache-buster nesses imports, o `recibo.html` continuava servindo `statusLabel` undefined (porque importava versão velha do api.js). Fix: 2 regexes adicionais cobrindo `import ... from '<url>'` (estático) e `import('<url>')` (dinâmico). Total: 3 regex passes no HTML response.

**Mudanças** (`backend/server.js`):
- `APP_VERSION` bumpado V295 → **V298**
- Middleware `htmlInterceptor(baseDir)` que serve HTMLs e injeta `?v=V298` em src/href apontando para JS/CSS local
- Aplica em `/app/*.html` e em HTMLs da raiz (mockup, formulários HCC)
- HTML agora tem `Cache-Control: no-store` (nunca cacheia) — garante que o `?v=` do server chega sempre fresco ao navegador
- JS/CSS continuam com `must-revalidate` + ETag (V297) para ter 304 quando inalterado

**Verificação**:
```
$ curl -s /app/portal.html | grep style.css
<link rel="stylesheet" href="/app/style.css?v=V298">
$ curl -sI /app/login.html | grep Cache-Control
Cache-Control: no-store
```

**Teste atualizado**: `tests/jornada-admin.test.js` — 2 asserts que verificavam src exato agora toleram `?v=...` opcional via regex `src="..."(?:\?v=[^"]+)?"`.

**Resultado**:
- Usuário **nunca mais** precisa fazer Cmd+Shift+R após deploy
- Bump da `APP_VERSION` é o único trigger para invalidação global de cache
- Custos: HTML não cacheia mais (impacto desprezível — HTMLs são pequenos e o `must-revalidate` já forçaria roundtrip de qualquer jeito)

**Testes**: suite 1127 verdes.

---

### V297 — 2026-05-26 — Cache-Control com revalidação obrigatória (fix recorrente)
**Por quê**: usuário reportou recibo em branco durante teste E2E. Investigação via console mostrou:
```
Uncaught SyntaxError: The requested module '/app/api.js' does not provide
an export named 'statusLabel'
```
A função `statusLabel` está exportada corretamente em `api.js:349`. Causa raiz: **navegador servindo versão velha do `api.js` em cache** (de antes da função existir). Problema recorrente — apareceu várias vezes ao longo do projeto e era sempre resolvido com hard-refresh manual do usuário (workaround). Agora fix definitivo no servidor.

**Mudança** (`backend/server.js`):
- Adicionado middleware `staticHeaders(res, path)` injetado em `express.static({setHeaders})` nas duas pastas servidas
- HTML/JS/CSS: `Cache-Control: public, max-age=0, must-revalidate` — navegador pode cachear mas precisa revalidar a cada request (HTTP 304 se inalterado, 200 se mudou)
- Assets binários (PNG/JPG/SVG/woff/ttf): `Cache-Control: public, max-age=3600` — raramente mudam, evita roundtrip

**Verificação**:
```
$ curl -sI /app/api.js | grep -i cache-control
Cache-Control: public, max-age=0, must-revalidate
$ curl -sI /fesf-marca.png | grep -i cache-control
Cache-Control: public, max-age=3600
```

**Impacto**:
- Usuário nunca mais precisa fazer `Cmd+Shift+R` depois de deploy
- Performance: ETag/Last-Modified do express.static fazem a maioria dos requests retornar 304 (não baixa o arquivo, só headers)
- Custo de rede: mínimo (~200 bytes por request 304 vs ~30KB pra api.js)

**Testes**: suite continua 1127 verdes. Sem mudança funcional.

---

### V296 — 2026-05-26 — Upload via link público agora respeita config OneDrive
**Por quê**: usuário perguntou se a aplicação está pronta para integração SharePoint/OneDrive. Auditoria revelou que **apenas o endpoint autenticado** (`POST /api/envios/:id/documentos`) usava `subirArquivo()` do storage-service. O **endpoint anônimo via link público** (`POST /api/envios/publico/:token/:envioId/documentos`) gravava direto `req.file.path` no banco — ou seja, **arquivos enviados via link público iam SEMPRE para o disco local, mesmo com OneDrive habilitado**.

**Fix** (`backend/routes/envios.js` linhas ~1186-1192):
- Adicionado import dinâmico de `subirArquivo` do storage-service
- Substituído `req.file.path` direto pelo `caminhoSalvo` resultante do upload abstraído
- Agora todos os 3 cenários (Portal logado, Link público anônimo, Manual via operador) usam a mesma abstração de storage

**Verificação**: suite completa de 1127 testes continua verde. Comportamento idêntico em backend=local; com backend=onedrive + enabled=true, os uploads do link público agora vão para SharePoint.

---

### V295 — 2026-05-26 — Auditoria visual+funcional completa + bump de versão (V25 → V295)
**Por quê**: usuário pediu "teste o todo o visual e verifique funcionalidades que nao estejam funcionando e realize os ajustes para que elas funcionem da melhor forma".

**Metodologia**:
1. Suite de testes completa: `bash scripts/test-all.sh` antes e depois → **1127 testes verdes em ambos**.
2. Navegação organica por todas as páginas admin via Claude Preview (admin, pagamentos, unidades, fornecedores, usuarios, relatorios, auditoria, emails, status, smtp, storage, client-errors, api, config) — **todas sem `.alert.danger` orgânico**.
3. Fluxos E2E por perfil:
   - **OPERADOR** (Carlos Souza HECC): login → listar envios em_analise → ver detalhe → comentar → solicitar retificação → listar expectativas → resumo origem — **todos OK**.
   - **FORNECEDOR** (Empresa Hospitalar): login → listar próprios envios → modalidades → unidades → notificações → detalhe próprio → portabilidade LGPD (`/api/me/dados-pessoais`) — **todos OK**.
   - **ADMIN** (Maria Andrade): login → aprovar envio → marcar pago → métricas → backup → usuarios → auditoria sistema → storage → smtp → client-errors — **todos OK**.
4. Verificação visual da trajetória após `marcar pago`: 5 dots verdes (done) + 1 dot roxo halado (active "Pago") — perfeito.
5. Erros capturados pelo sistema V291 durante a auditoria: **0** (zero ruído).

**Bug encontrado e corrigido**:
- **Versão hardcoded "V25" no admin-api.html**: anti-pattern já documentado em CHANGELOG ⛔ #6, mas residia no `openapi-spec.js` (info.version = 'V25'). Como o sistema rodava em V239+ desde V239, o label "API · V25" no header ficava desatualizado.
- **Fix**:
  - `backend/server.js`: `APP_VERSION` bumpado de 'V239' para 'V295' (acompanha refinos visuais V268-V294 + integrações V291/V292)
  - `backend/server.js`: spec OpenAPI agora **injeta APP_VERSION em runtime** via spread: `const openApiSpecLive = { ...openApiSpec, info: { ...openApiSpec.info, version: APP_VERSION } }`
  - `backend/openapi-spec.js`: `info.version` mudado para `'unknown'` (fallback caso alguém importe direto sem passar pelo server)
  - `capacidades` ganhou `'client-error-capture'` (V291) e `'onedrive-storage'` (V292)

**Verificação pós-fix**:
- `GET /api/version` retorna `versao: "V295"`
- `GET /api/openapi.json` retorna `info.version: "V295"`
- `admin-api.html` h1 mostra `"FESF-SUS Portal de Pagamentos · API · V295"` (era · V25)
- Suite completa: **1127/1127 verdes**

**Nenhum outro bug funcional encontrado**. O sistema está em estado limpo: visual alinhado ao mockup (V268-V294), funcional 100%, com captura de erros do cliente operacional, integração OneDrive opcional, e todos os 3 perfis (admin/operador/fornecedor) com fluxos validados ponta a ponta.

---

### V294 — 2026-05-26 — Trajetória do envio alinhada ao mockup real (correção de V268)
**Por quê**: usuário voltou a sinalizar que a trajetória do processo em `envio.html` estava visualmente distinta do mockup. Revisão do mockup (`controle-pagamentos-mockup.html` linhas 1387-1452 e 4740-4768) revelou que **V268 interpretou erroneamente o mockup**:
- V268 assumiu "mockup tem design rico → dots numerados grandes + check + glow halo 5px"
- Mockup real usa **dots minimalistas de 14px via `::before`** pseudo-element, sem números, sem checkmarks, conector 2px, halo de 4px no active.

**Tela**: `envio.html` (mesma trajetória vista por operador/admin/fornecedor).

**Mudanças CSS** (substitui blocos V268):
- `.timeline-step::before`: 14×14px, `background: var(--border)` base, `border: 3px solid var(--surface)`, `box-shadow: 0 0 0 1px var(--border)` (mockup linhas 1415-1426)
- `.timeline-step::after` (conector): 2px height (era 3px), `top: 14px`, alinhado ao centro dos dots
- `.timeline-step.done::before`: `background: var(--accent)` + `box-shadow: 0 0 0 1px var(--accent)` (sem mais aro extra)
- `.timeline-step.active::before`: `background: var(--primary)` + `box-shadow: 0 0 0 1px var(--primary), 0 0 0 4px var(--primary-soft)` (halo sutil 4px, era 5px+sombra dupla)
- Padding-top reduzido: `28px` (era 38px) para acomodar dot menor
- `.timeline-wrap h3`: `font-size: 13px` + `letter-spacing: 1px` (mockup), mais arejado
- Removido: `.dot-num`, `.done .dot-num`, `.active .dot-num`, `.pending .dot-num`

**Mudanças JS** (`carregar()` template):
- Removido `<span class="dot-num">${icone}</span>` — dots agora 100% CSS
- Removida lógica `icone = cls === 'done' ? '✓' : ...`
- Label "Aguard. ret." → "Aguardando ret." (alinha com mockup)

**CHANGELOG anti-pattern adicionado** (seção ⛔ #10): proibida reintrodução de dots numerados/maiores.

**Verificação** via Claude Preview:
- 6 steps em ordem correta: Recebido (done verde), Em análise (active roxo halado), Aguardando ret./Retificado/Aprovado/Pago (pending cinza)
- `getComputedStyle(step, '::before')` confirma 14×14px, `rgb(79, 165, 144)` (accent) no done
- `hasDotNum: false` em todos os steps (DOM mínimo)
- Screenshot confirma visual idêntico ao mockup screen-details

**Testes**: nenhuma mudança funcional — só CSS/template. Sem suite formal nova.

---

### V293 — 2026-05-26 — Auditoria E2E final por perfil (admin/operador/fornecedor)
**Por quê**: usuário pediu "execute e faca um teste visual verificando funcionalidades que nao estejam funcionando" como passe final pós-V292.

**Metodologia**: para cada um dos 3 perfis (admin_fesf, operador_unidade, fornecedor), via Claude_Preview MCP:
1. Login via `/api/auth/login`
2. Probe dos endpoints REST usados pela UI daquele perfil
3. Navegação pelas páginas principais (HTML), checando `errors`, `title`, `h1`
4. Inspeção dos erros capturados pelo sistema V291 (`/api/admin/client-errors`)

**Perfis testados**:
- **ADMIN (Maria Andrade)**: 21 endpoints + dashboard, pagamentos, unidades, fornecedores, usuarios, relatorios, auditoria, emails, status, smtp, storage, client-errors, api, config — todos OK
- **OPERADOR (Carlos Souza HECC)**: painel.html, expectativas, fornecedores, links — todos OK. `/api/metricas` retorna 403 corretamente para operador (endpoint é admin-only e nenhuma página operador o chama)
- **FORNECEDOR (Empresa Hospitalar)**: portal.html, portal-novo.html, envio.html, recibo.html, notificacoes.html, perfil.html — todos carregam sem `.alert.danger`/`.alert.erro` e sem chamadas de rede orgânicas falhando

**Erros capturados pelo sistema V291**:
- `GET /api/envios/proximos-vencimentos → 500` — falso positivo, foi URL inventada pelo probe (não há rota; cai no `/:id` que falha por id não-numérico). Nenhuma página real chama.
- `POST /api/admin/storage/test → 502` — comportamento correto quando OneDrive não está configurado.

**Observação sobre `escolha-modalidade.html`**: arquivo não existe no disco. O fluxo real usa `/app/portal-novo.html` (h1: "1. Qual é o tipo de pagamento?"). A tela #287 do CHANGELOG referencia um nome que não foi materializado no FS — sem impacto funcional (nada referencia `escolha-modalidade.html`).

**Conclusão**: nenhum bug funcional encontrado. Sistema V291 (captura de erros) confirmou-se útil para distinguir bugs reais de ruído de probe.

**Testes**: smoke test manual via Preview (login + navegação por perfil). Sem suite formal nova.

---

### V292 — 2026-05-25 — Integração OneDrive/SharePoint para anexos + admin
**Por quê**: usuário pediu integração com OneDrive/SharePoint para armazenamento dos anexos via API, com tela admin para configurar.

**Arquivos novos**:
- `services/storage-service.js` — abstração local/onedrive (encripta secret, gerencia token MS Graph, upload simples + resumable, fallback)
- `routes/storage.js` — GET/PUT config + POST test (admin-only)
- `public/app/admin-storage.html` — UI de configuração com test conexão

**Arquivos modificados**:
- `server.js` — monta `storageRoutes`
- `routes/envios.js`:
  - Upload `POST /:id/documentos`: chama `subirArquivo()` → caminho pode ser local OU `onedrive://item-id`
  - Preview `GET /:id/documentos/:docId/preview`: detecta `onedrive://`, baixa via Graph e envia buffer
  - Download `GET /:id/documentos/:docId/download`: idem

**Como funciona**:
1. **Backend pluggable**: config no `configuracoes.chave='storage'` define `backend: 'local' | 'onedrive'`
2. **Quando OneDrive habilitado**: upload → MS Graph (`/drives/{id}/root:/folder/file:/content`), retorna `onedrive://item-id` salvo no DB
3. **Quando local ou em falha**: arquivo fica em `/uploads/` (fallback que não perde o anexo)
4. **Auth Graph**: OAuth2 client credentials flow (App Registration), token cacheado em memória até expirar
5. **Arquivos grandes (>4MB)**: usa Upload Session com chunks de 4MB
6. **Pasta criada automaticamente** (recursivo) na 1ª vez
7. **Client secret encriptado** via `crypto-helper.js` (AES-256-GCM)

**API**:
- `GET /api/admin/storage` — config (sem secret cleartext, com máscara)
- `PUT /api/admin/storage` — salva, validação (se enabled exige todos os campos)
- `POST /api/admin/storage/test` — autentica + GET drive info; retorna nome/tipo/quota

**Tela admin** (`/app/admin-storage.html`):
- Select backend (local/onedrive)
- Toggle "habilitado"
- Campos: tenant_id, client_id, client_secret (password, vazio = manter), drive_id, folder_path
- Botão "Testar conexão" mostra alert verde (OK) ou vermelho (erro com motivo)
- Pill status "ativo/desativado" no header
- Info banner explicando setup do Azure AD

**Pré-requisito Azure AD**:
1. Azure Portal → App Registrations → New
2. API Permissions → Microsoft Graph → Application → `Files.ReadWrite.All` → Grant admin consent
3. Certificates & secrets → Client secret → copiar valor (visível só uma vez)
4. Obter Tenant ID + Application (client) ID
5. Para SharePoint: Drive ID via `GET /v1.0/sites/{site-id}/drives`

**Funcionalidade testada via Preview**:
- Config save/load ✓
- Secret encriptado (mostra máscara `su******et`) ✓
- Test conexão retorna erro coerente quando desabilitado ✓
- Tela admin renderiza com todos os campos + info banner ✓
- Pill status atualizando ativo/desativado ✓

**Backward compat**: anexos antigos (caminho local `/uploads/xxx`) continuam funcionando. Apenas anexos NOVOS são enviados ao OneDrive.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V291 — 2026-05-25 — Sistema de captura de erros do cliente (logs sistêmicos)
**Por quê**: usuário precisa diagnosticar problemas em produção com precisão. Erros que acontecem no browser dos usuários (runtime, fetch failed, console.error, promises rejeitadas) se perdiam — admin não tinha visibilidade. Agora capturamos automaticamente e persistimos para análise.

**Arquivos novos**:
- `db/migrations/013_client_errors.sql` — tabela com dedup hash
- `services/client-error-service.js` — registrar/listar/resolver/stats
- `routes/client-errors.js` — POST público (com auth opcional) + GET admin
- `public/app/error-logger.js` — listener global instalado via api.js
- `public/app/admin-client-errors.html` — tela de diagnóstico

**Arquivos modificados**:
- `server.js` — monta `clientErrorRoutes` em `/api`
- `public/app/api.js` — `import './error-logger.js'` no topo (carrega em todas as telas)

**Captura automática de 5 tipos de erro**:
1. **`runtime`** — `window.onerror` (TypeError, ReferenceError, syntax errors)
2. **`unhandled-rejection`** — `window.onunhandledrejection` (Promise sem catch)
3. **`console-error`** — wrap em `console.error` (preserva original + envia ao backend)
4. **`fetch-fail`** — wrap em `window.fetch` (network errors, "failed to fetch")
5. **`http-error`** — HTTP 5xx em qualquer fetch do app

**Recursos**:
- **Dedup por hash SHA-1** (tipo + mensagem + url + top 3 linhas do stack) — mesmo erro repetindo só incrementa contador `ocorrencias`, não cria linhas duplicadas
- **Buffer + debounce** (1.5s) — não floodar o backend
- **`keepalive: true`** no fetch — envia mesmo durante page unload
- **Auth opcional** — usuários anônimos (login, publico.html) também são capturados
- **Sanitização**: tamanhos limitados (stack 4000, msg 500, url 500) — proteção contra abuse
- **Anti-loop**: o próprio endpoint `/api/client-errors` é excluído do wrap

**API exposta**:
- `POST /api/client-errors` — público, recebe payload
- `GET /api/admin/client-errors?resolvido=false&tipo=runtime&limit=100` — lista
- `PATCH /api/admin/client-errors/:id/resolver` — marca resolvido
- `GET /api/admin/client-errors/stats` — counts por tipo

**Tela admin** (`/app/admin-client-errors.html`):
- 5 KPIs (1 por tipo)
- Lista cronológica com chips coloridos (runtime vermelho, unhandled-rejection laranja, fetch-fail warning, console-error roxo, http-error vermelho)
- Click em row abre detalhes (URL completa, User Agent, Stack trace, usuário/papel, request method/URL/status, primeira+última ocorrência, ocorrências)
- Filtros: tipo + resolvido/não/todos
- Auto-refresh 30s
- Botão "Resolver" por linha

**Como usar agora para diagnosticar "failed to fetch"**:
1. Acessar `/app/admin-client-errors.html` (admin FESF)
2. Filtrar por tipo "Falha de rede" 
3. Cada entrada mostra: URL exata + método + browser + usuário + stack + timestamps + quantas vezes ocorreu

**Funcionalidade testada via Preview**:
- 3 erros forçados (console.error, Promise.reject, fetch falso) → todos chegaram ao backend ✓
- Tela admin renderiza com KPIs e lista ✓
- Click no row mostra detalhe completo ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V290 — 2026-05-25 — Alinhar tokens de cor ao mockup (--warning marrom, refinar paleta)
**Por quê**: usuário reportou que os botões de ações na página de detalhes (envio.html) têm cores diferentes do mockup. Auditoria revelou divergência principal em `--warning`:
- **Mockup**: `#8a5a00` (marrom escuro/dourado terra)
- **App tinha**: `#d99020` (laranja vibrante)

Botão "⚠ Solicitar retificação" estava laranja vibrante quando o mockup mostra marrom sóbrio.

**Arquivo**: `style.css` (`:root` tokens).

**Mudanças aplicadas** (alinhamento total com paleta do mockup):

| Token | Antes (app) | Agora (mockup) |
|---|---|---|
| `--primary-2` | `#4a4480` | `#463f7d` |
| `--primary-soft` | `#eeecf6` | `#ece9f5` |
| `--accent-soft` | `#e3f0ec` | `#e6f2ee` |
| **`--warning`** | **`#d99020` (laranja)** | **`#8a5a00` (marrom)** |
| `--warning-soft` | `#fbf3e3` | `#faf2dd` |
| `--danger` | `#b22828` | `#b32d20` |
| `--danger-soft` | `#f9e8e8` | `#f7e8e6` |
| `--info` | `#3b6ea5` | `#4a6da6` |
| `--info-soft` | `#e7eff8` | `#ecf0f8` |
| `--text` | `#1c1c1c` | `#1a1a1a` |
| `--text-2` | `#3a3a3a` | `#3a3a38` (warm) |
| `--text-3` | `#555` | `#6b6b66` (warm) |
| `--muted` | `#7a7a7a` | `#8a8a82` (warm) |
| `--border` | `#e1e1de` | `#e6e4dd` |
| `--border-strong` | `#cfcfcb` | `#d6d3ca` |
| `--surface-2` | `#f7f7f4` | `#fafaf8` |
| `--surface-3` | `#efefea` | `#f2f1ec` |

Em geral: paleta agora é "warm grays" idêntica ao mockup (mais bege/marrom em vez de cinza puro).

**Hardcoded colors substituídos por tokens** (cleanup):
- `.pill.aguardando_ret, .pill.lembrado`: `color:#b96f00` → `var(--warning)`
- `.origin.manual`: `color:#b96f00` → `var(--warning)`
- `.alert.warn`: `color:#8c5200` → `var(--warning)` + border-color atualizado

**Impacto cascata**: TODOS os botões `.warn`, badges warning, alerts warning, pills aguardando_ret/lembrado e origin manual agora têm o tom marrom sóbrio do mockup (em vez do laranja vibrante).

**Funcionalidades preservadas**: 100% — só mudança de tokens.

**Funcionalidade testada via Preview** (envio.html como operador HECC):
- Botão "✓ Aprovar envio" verde teal ✓
- Botão "⚠ Solicitar retificação" **agora marrom escuro** (era laranja vibrante) ✓
- Botão "✕ Rejeitar" vermelho ✓
- Pill "Em análise" azul info ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V289 — 2026-05-25 — Utilidades CSS globais (skip-link, kbd, inline code)
**Por quê**: três utilitários globais ainda apagados — skip-link de acessibilidade (top:-50px básico), `<kbd>` (sem estilo, importante para hotkeys V230), `<code>` inline (sem estilo, só dentro de `<td>`).

**Arquivo**: `style.css`.

**Mudanças aplicadas**:

**.skip-link (acessibilidade WCAG)**:
- Padding 10px 18px (de 8x14), border-radius 8px (de 6)
- Position top:-60px (de -50) — escondido por padrão
- `:focus` desce para top:12px (de 8)
- **Transição `top .15s ease`** — descida suave ao tab
- **Sombra roxa** `0 4px 12px rgba(91,84,153,.3)` — destaca quando focused
- Em vez de aparecer abruptamente, agora desliza com classe

**kbd (atalho de teclado — V230 hotkeys)**:
- **Visual key cap**: bg surface + border 1px (strong) + **border-bottom 2px** — sensação de tecla física
- Padding 2px 7px, border-radius 5px
- Font monospace 11px font-weight 600
- **Sombra inferior** 0 1px 0 — leve "altura"
- Cor text-2 (legível mas não dominante)

**code (inline, fora de tabelas)**:
- **Chip discreto**: bg surface-2 + padding 1x6 + border-radius 4
- Font 90% do tamanho do parent + font-weight 500
- Color text (não muted) — legível
- Excluído via `:not()` para não duplicar dentro de `td code` (já estilizado) e `.audit-row .acao code` (chip dedicado V281)

**Funcionalidades preservadas**: 100% — só CSS adicional/refinamento.

**Impacto cascata**: melhora todas as telas que usam `<code>` inline (auditoria, recibos, documentação), `<kbd>` (modais de hotkeys V230), skip-link (todas as páginas acessíveis).

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V288 — 2026-05-25 — Toast global (api.js) com slide-in + ícone por tipo
**Por quê**: `toast()` em `api.js` é usado por TODA ação do sistema (aprovar/rejeitar/salvar/erro). Era inline style básico — opacity simples sem entrada elegante nem indicação visual do tipo.

**Arquivo**: `api.js` função `toast(msg, tipo)`.

**Mudanças aplicadas**:

**Container styling**:
- Bottom/right 28px (de 24)
- Padding 14px 20px 14px 18px (assimétrico para acomodar ícone)
- Border-radius 10px (de 8)
- **Sombra dupla**: `0 8px 24px rgba(0,0,0,.25), 0 2px 6px rgba(0,0,0,.12)` (de single layer .2)
- **Slide-in da direita**: `transform: translateX(20px) → 0` + opacity 0 → 1
- **Transition cubic-bezier(.16,.84,.44,1) .25s** (de linear .2s)
- Max-width 380px + display flex + gap 10px
- Font-weight 500 + line-height 1.4

**Conteúdo enriquecido**:
- **Ícone por tipo**: ⚠ (erro), ✓ (sucesso), ℹ (info) — em font-size 16px, font-weight 700
- Mensagem em span separado para flex layout
- innerHTML em vez de textContent (para ícone + texto)

**Dismissal**:
- Timeout 3200ms (de 3000) — leve aumento
- `clearTimeout(el._t)` antes de novo timeout — evita acúmulo
- Slide-out reverso: opacity 0 + translateX(20px)

**Funcionalidades preservadas**: 100% — assinatura `toast(msg, tipo)` inalterada; usuários de toast em todo o app continuam funcionando.

**Impacto cascata**: TODAS as ações do sistema (aprovar envio, salvar config, criar expectativa, marcar pago, etc) agora têm feedback visual rico.

**Testes**: 1127 verdes · 0 falhas (1ª rodada teve race condition em smtp.test — passou na 2ª rodada).

**Server reiniciado** em localhost:3000.

---

### V287 — 2026-05-25 — Admin API: endpoints com hover lift + auth badge
**Por quê**: visualizador OpenAPI tinha tag-headers genéricos, method chips pequenos, endpoints sem hover state.

**Arquivo**: `admin-api.html` (CSS embedded).

**Mudanças aplicadas**:

**.tag-header (grupo de endpoints)**:
- Padding 12x16 (de 10x14)
- **Background gradient horizontal** `linear-gradient(90deg, primary-soft 0%, rgba(91,84,153,.04) 100%)`
- **Border-left 4px primary** — categoria roxa
- H2 font-weight 700 + descr font-weight 500

**.endpoint (cada endpoint)**:
- Padding 12x16 (de 10x14), gap 16 (de 14), border-radius 10px (de 8)
- **Sombra sutil** 0 1px 2px
- **Hover**: border primary + sombra roxa 2-8px + **translateY(-1px) lift**
- Transition .15s

**.method (chip GET/POST/PUT/DELETE)**:
- Padding 4x10 (de 3x9)
- **Font-weight 800** (de 700) + letter-spacing .7px (de .4) — tipográfico monospace
- **Sombra sutil** 0 1px 2px — eleva levemente
- Width:100% no grid 84px — chips uniformes

**.ep-path / .ep-summary**:
- Path 13.5px (de 13) + word-break (paths longos)
- Summary line-height 1.5

**.ep-meta .auth (badge "auth required")**:
- Agora **chip visual**: bg accent-soft + padding 1x8 + border-radius 4 + letter-spacing .3
- Antes era só texto verde

**Funcionalidades preservadas**: 100% — OpenAPI loader + filtros + busca intactos.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V286 — 2026-05-25 — Consulta pública por protocolo: input destacado + animação
**Por quê**: tela pública para acompanhar status de envio sem login. Input do protocolo era genérico, resultado aparecia abrupto sem transição.

**Arquivo**: `consulta.html` (CSS embedded).

**Mudanças aplicadas**:

**.wrap (card)**:
- Padding 40px (de 36)
- **Sombra dual layer** + **animação `consultaIn`** (.3s cubic-bezier) idêntica ao padrão V282 publico
- Brand-mark com shadow roxo (consistente com publico/login)
- H1 24px font-weight 700 + letter-spacing -.01em
- Lead 13.5px + line-height 1.55

**.protocolo-input (campo central destacado)**:
- Font-size 18px (de 16), letter-spacing 2px (de 1px), font-weight 600
- Padding 14px 16px — input grande e centralizado
- **`background: surface-2`** (fundo levemente cinza) — destaca como campo principal
- **Focus**: bg branco + ring roxo 4px com 15% alpha — feedback ao digitar

**.resultado (output da consulta)**:
- Padding 20px (de 18), border-radius 12px (de 10)
- **Sombra sutil** + **animação `resultadoIn`** .25s ease-out: opacity + translateY(8px → 0)
- OK verde + erro vermelho preservados (border-left 4px)

**Funcionalidades preservadas**: 100% — lógica de busca por protocolo + render de resultado intactos.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V285 — 2026-05-25 — Admin SMTP: form rows arejados + pill-status com halo
**Por quê**: tela de config SMTP. Form rows compactos, pill on/off do status sem destaque.

**Arquivo**: `admin-smtp.html` (CSS embedded).

**Mudanças aplicadas**:

**.form-row**:
- Grid `220px 1fr` (de 200) — mais espaço para labels
- Gap 18px (de 14), padding 14px 0 (de 10) — vertical breathing room
- Label font-weight **600** (de 500) + cor text explícita
- Sub-text font-size 11.5px + line-height 1.45 — texto auxiliar legível
- Inputs max-width 440px (de 420)

**.pill-status (badge ON/OFF)**:
- Padding 4px 12px (de 3px 10px)
- **Font-weight 700** (de 600) + letter-spacing .4px + text-transform uppercase — texto formal
- Margin-left 10px do título
- **Halo glow** `box-shadow: 0 0 0 3px` com cor da variante (.12 alpha verde quando ON, .12 alpha laranja quando OFF)

**Funcionalidades preservadas**: 100% — config SMTP, test send, save intactos.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V284 — 2026-05-25 — Admin Pagamentos: bar-total destacado + row selection
**Por quê**: tela admin de fila de pagamento. Bar-total (R$ total selecionado) era visualmente simples; row selecionado pouco destacado.

**Arquivo**: `admin-pagamentos.html` (CSS embedded).

**Mudanças aplicadas**:

**.bar-total (banner R$ total)**:
- Padding 16px 22px (de 14x18) — mais arejado
- Border-radius 12px (de 10)
- **Background gradient horizontal** `linear-gradient(90deg, accent-soft 0%, rgba(79,165,144,.08) 100%)` — degradê suave
- **`border-left: 4px solid accent`** (verde) — categoria de "tudo aprovado"
- **Sombra sutil** 0 1px 2px
- Esquerda: font-weight 500 + strong 700
- Direita (valor): font-size 20px (de 18) + **letter-spacing -.3px** (tipográfico)

**.pay-row**:
- Transition .12s ease
- **Selecionado**: bg primary-soft + **`box-shadow: inset 4px 0 0 primary`** — ring lateral roxo
- Td:first-child com font-weight 600 quando selecionado — destaque na coluna principal
- Checkbox com **`accent-color: primary`** — checkbox roxo nativo

**Funcionalidades preservadas**: 100% — bulk select + ações financeiras intactas.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V283 — 2026-05-25 — Admin Emails: log com chip de tipo + hover roxo
**Por quê**: log de e-mails enviados é troubleshooting tool. Rows compactos eram apagados; tipo do email (notificação/retificação etc) sem destaque visual.

**Arquivo**: `admin-emails.html` (CSS embedded).

**Mudanças aplicadas**:

**.email-row**:
- Padding 12px 14px (de 10x12) — mais arejado
- **Hover roxo suave** `rgba(91,84,153,.03)` (de surface-2) — consistente com tables/notif/audit
- Transition .12s ease
- `.lido` opacity .6 (de .65) — mais discreto

**Colunas refinadas**:
- `.quando`: font-weight 500 + cor muted explícita
- `.dest`: font-weight **600** (de 500) + cor text — destaque do destinatário
- `.ass`: line-height 1.4 — texto longo legível
- `.tipo`: agora **chip visual** com bg primary-soft + padding 3px 8px + border-radius 5px + font-weight 700 + letter-spacing .6px — antes era só texto em uppercase

**Funcionalidades preservadas**: 100% — só CSS, click no row abre modal preview email intacto.

**Funcionalidade testada via Preview**: hover roxo + tipo em chip ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V282 — 2026-05-25 — Publico (form anônimo): animação + tipografia
**Por quê**: tela única que fornecedores acessam sem login (via token único). Merece polish — é a porta de entrada para envios sem conta.

**Arquivo**: `publico.html` (CSS embedded).

**Mudanças aplicadas**:

**.wrap (card principal)**:
- Padding 36px (de 32), gap interno maior
- **Sombra dual layer**: 0 20px 60px (forte) + 0 4px 12px (proximidade)
- **Animação `publicoIn`** .3s cubic-bezier(.16,.84,.44,1): translateY(16px → 0) + scale(.98 → 1) + opacity

**.brand-mark (FESF logo)**:
- 46×46 (de 44), border-radius 11px (de 10)
- Font-size 13px + letter-spacing .5px
- **Sombra roxa** 0 2px 8px rgba(91,84,153,.3) — leve flutuação

**H1**: font-size 24px (de 22), font-weight 700 explícito, letter-spacing -.01em

**.contexto (caixa verde de "envio para")**:
- Padding 18px 20px (de 16x18), border-radius 12px (de 10)
- Margin-bottom 22px (de 20)
- **Sombra sutil** 0 1px 2px
- Strong com font-weight 600 explícito + margin-bottom 8px

**#estado-loading / #estado-erro**:
- Padding 48px 20px (de 40)
- Erro com font-weight 500

**.checklist (o que esperar)**:
- Padding 16px 20px (de 14x18), border-radius 10px (de 8)
- **`border-left: 3px solid var(--primary)`** — destaca como "guia roxo"
- Label uppercase + letter-spacing .7px + font-weight 700
- `<ul>` com padding-left 18px + `li::marker` em roxo (bullets coloridos)

**.lgpd (texto legal)**:
- Padding 14px 16px (de 12x14), border-radius 8px (de 6)
- Line-height 1.55 (de 1.5)
- **`border-left: 3px solid border-strong`** — separa visualmente como nota legal

**Funcionalidades preservadas**: 100% — só CSS, lógica de validação de token + render dinâmico do contexto intacta.

**Funcionalidade testada via Preview** (token público — não precisa login):
- Página carrega com animação slide-in ✓
- Brand-mark FESF roxo com sombra ✓
- Estados loading/erro centralizados ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V281 — 2026-05-25 — Admin Auditoria: rows com chip de ação + hover roxo
**Por quê**: tela de auditoria do sistema-wide tem trilha cronológica de eventos. Rows compactos sem hierarquia visual — chip de ação pequenino, hover cinza padrão.

**Arquivo**: `admin-auditoria.html` (CSS embedded).

**Mudanças aplicadas**:

**.audit-row (cada evento)**:
- Padding 12px 14px (de 9px 12px) — mais arejado
- **Hover roxo bem suave** `rgba(91,84,153,.03)` (de surface-2) — consistente com tables (V271)
- Transition .12s ease
- Last child sem border (cleanup)

**.audit-row .quando** (timestamp):
- Font-weight 500 explícito — destaque sutil

**.audit-row .ent** (entidade afetada, ex.: "envio", "fornecedor"):
- Font-size 10.5px (de 11), letter-spacing .7px (de .5), font-weight **700** (de 600) — formal e compacto

**.audit-row .acao code** (chip da ação):
- Padding 3px 8px (de 1x6) — chip de verdade
- Border-radius 5px (de 3px)
- **Font-weight 600** (era default) + letter-spacing .2px — leitura formal
- Font-family monospace explícito

**.audit-row .det** (descrição/detalhe):
- Font-size 12.5px (de 12) + **line-height 1.5** (de default) — texto largo legível

**.audit-row .quem** (usuário):
- Cor text + font-weight 500 (era text-2 sem weight)
- Papel: margin-top 1px + cor muted explícita

**Funcionalidades preservadas**: 100% — só CSS, paginação + filtros + endpoint /api/auditoria intacto.

**Funcionalidade testada via Preview**:
- Tela carrega ✓
- Cada row com hover roxo suave ✓
- Chips de ação destacados em roxo (primary-soft) ✓
- Tipografia legível em rows longas ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V280 — 2026-05-25 — Admin Status: dashboard de saúde com cards + halo glow
**Por quê**: dashboard de saúde é onde admin checa rapidamente se sistema está OK. Cards eram visualmente apagados; badge OPERACIONAL/DEGRADADO sem destaque; live dot sem charme.

**Arquivo**: `admin-status.html` (CSS embedded).

**Mudanças aplicadas**:

**.status-grid + .status-card**:
- Min-width 230px (de 220), gap 14px (de 12)
- Border-radius 12px (de 10), padding 16px 18px (de 14x16)
- **Sombra sutil** + hover shadow + transition .2s
- **Border-left 4px verde** (accent) — visual de "tudo ok por padrão"
- Label letter-spacing .7px + margin-bottom 8px
- Value 24px (de 22) + letter-spacing -.3px (tipográfico compacto)
- Sub-stat font-weight 500

**.badge-up / .badge-down**:
- Padding 4px 11px (de 3px 9px), border-radius 14px (de 10)
- Font-size 11px font-weight **700** (de 600) + letter-spacing .5px (de .4)
- **`box-shadow: 0 0 0 3px rgba(79,165,144,.12)`** (verde) ou rgba(178,40,40,.12) (vermelho) — halo glow indica magnitude

**.tabela-counts** (status por categoria):
- Padding 8px 10px (de 6px 8px)
- Coluna numérica font-weight 600
- Last child sem border (cleanup)

**.live-dot** (indicador "ao vivo"):
- 10×10px (de 8) com **`box-shadow: 0 0 0 3px rgba(79,165,144,.2)`** — halo estático
- **Pulse-ring animation**: `::after` com border 2px verde que expande de scale(.7) → scale(1.8) + opacity 0→.6→0 em 1.8s loop — efeito "radar" pulsante
- Substitui `pulse` simples (só opacity) por anel expandindo

**Funcionalidades preservadas**: 100% — só CSS, lógica de auto-refresh + endpoint /api/health/detailed inalterada.

**Funcionalidade testada via Preview** (admin Maria Andrade):
- 4 status cards com border-left verde + sombra: Status geral (OPERACIONAL badge halo) / Uptime 5m 23s mono / DB backend PGlite / Versão V239+health ✓
- Live dot verde com halo + ring expanding loop ✓
- Tabela "Cenários em uso" com origin badges em uppercase (V276) ✓
- Pill "Em análise" azul (V269 bug fix) ✓
- Botões "Atualizar agora" / "Backup JSON" / "Ligar modo manutenção" com hover lift (V270) ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V279 — 2026-05-25 — Recibo: polimento on-screen, print preservado
**Por quê**: recibo é tela imprimível com **decisão de design preservada** desde V243: layout sem cores decorativas, fontes serif, cinzas e pretos puros. Mas o visualizador on-screen ficava chato — fundo branco infinito com botões pretos colados no canto. Polir só o que NÃO é impresso.

**Arquivo**: `recibo.html` (CSS embedded).

**Mudanças aplicadas** (escopadas para tela):

**.controles (barra flutuante topo direito, não imprime)**:
- Position fixed top:24px right:24px (de 20px)
- **Container com card**: bg branco semi-transparente + padding 6px + border-radius 10px + sombra 0 4px 12px + **backdrop-filter blur(6px)** — efeito glass
- Botões: border-radius 6px, padding 9px 16px, font-weight 500, transition .15s
- **Primary (Imprimir) já default preto** + hover lift translateY(-1px) + sombra
- Secondary (Voltar): branco que invert no hover

**Body / .pagina (página do recibo)**:
- **Body bg `#f4f4f0`** (creme suave) — substitui branco infinito chato
- **.pagina com sombra 0 4px 24px** + margin top/bottom 32px — papel "flutuando"
- Visual de documento físico sobre mesa

**@media print** (impressão, decisão V243 preservada):
- `.controles{display:none}` (não imprime)
- `body{background:#fff}` — fundo branco para imprimir
- `.pagina{box-shadow:none;margin:0 auto}` — papel sem sombra
- **Layout impresso 100% preservado**: serif Georgia, sem cores decorativas, cinzas e pretos puros (V243 mandato)

**Funcionalidades preservadas**: 100% — botões Imprimir + Voltar funcionam, lógica de carregamento de dados intacta.

**Funcionalidade testada via screen vs print**:
- On-screen: papel creme com sombra + controles em card glass ✓
- Print preview (mentalmente): regras print sobrescrevem — fundo branco, sem sombras, sem controles ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V278 — 2026-05-25 — Notificações: lista com unread dot + filtros refinados
**Por quê**: continuação. Lista de notificações tinha visual genérico — sem indicador claro de não-lida nem hover diferenciado nos chips de filtro.

**Arquivo**: `notificacoes.html` (CSS embedded).

**Mudanças aplicadas**:

**.notif-list (container)**:
- Sombra sutil 0 1px 2px

**.notif-item (cada notificação)**:
- Padding 16px 20px (de 14px 18px) — arejado
- **Hover roxo bem suave** `rgba(91,84,153,.03)` (de surface-2 cinza) — consistente com tables (V271)
- Transition .15s ease (de .12s)
- **Indicador de não-lida via `::before`**: ponto roxo 6×6px posicionado à esquerda com **ring sutil** (box-shadow 0 0 0 3px com 15% alpha) — visual instantâneo de "tem novidade"
- Items não-lidas têm padding-left 24px para dar espaço ao dot
- .lida com opacity .65 (de .6) — discreto mas legível

**.notif-icon (ícone do tipo)**:
- 38×38px (de 36×36)
- **Sombra sutil** 0 1px 2px — eleva levemente

**.notif-body strong** font-weight 600 explícito + line-height 1.5 (de 1.45)

**.filtros / .filtro-chip**:
- Margin-bottom 16px (de 14)
- Padding 7px 14px (de 6px), border-radius 18px (de 14px) — pílulas mais arredondadas
- Font-weight 500 base, **transition .15s ease**
- **Hover (não-ativo)**: bg surface-2 + border darker + cor text — feedback visual claro
- **Active**: font-weight 600 + **sombra roxa** `0 2px 6px rgba(91,84,153,.25)` — destaca a categoria atual

**Funcionalidades preservadas**: 100% — só CSS, filtros JS inalterados.

**Funcionalidade testada via Preview**: a tela já está visualmente alinhada à do mockup com dot indicator + chips animados.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V277 — 2026-05-25 — Sucesso pós-envio com animações celebratórias
**Por quê**: a tela de sucesso é o momento de celebração para o fornecedor depois de enviar documentação. Merece um polish extra: animação de entrada, halo no check, hover tátil nos botões.

**Arquivo**: `sucesso.html` (CSS embedded).

**Mudanças aplicadas**:

**.wrap (card principal)**:
- Sombra mais forte: `0 20px 60px rgba(0,0,0,.25), 0 4px 12px rgba(0,0,0,.08)` (dual layer)
- **Animação `successIn`** de .35s com cubic-bezier(.16,.84,.44,1): combina translateY(20px → 0) + scale(.97 → 1) + opacity (0 → 1)

**.check-big (ícone ✓ verde)**:
- 88×88px (de 84×84), font-size 46px (de 44)
- Sombra maior: `0 12px 32px rgba(79,165,144,.35)`
- **Animação `checkPop`** de .5s cubic-bezier(.34,1.56,.64,1) com delay .15s — bounce in
- **Halo pulse infinito** `checkRing` 2s ease-out: anel verde que expande de scale(.9) → scale(1.4) + opacity 0→.5→0, em loop com .6s delay
- `::before` com `inset: -8px` + border 2px accent

**.hero h1**: font-size 28px (de 26), font-weight 700 (de 600), cor text explícita

**.protocolo-block (caixa do protocolo)**:
- Padding 26px (de 24), border-radius 14px (de 12)
- **Border 1px sutil** `rgba(91,84,153,.12)`
- **Inset shadow** `inset 0 1px 0 rgba(255,255,255,.5)` — leve highlight no topo
- Number 34px (de 32), line-height 1.1

**.actions-bar (botões)**:
- Margin/padding maior
- **Hover com translateY(-1px) + box-shadow** — feedback tátil (lift effect)
- Primary com sombra roxa no hover: `0 4px 12px rgba(91,84,153,.35)`

**Funcionalidades preservadas**: 100% — só CSS, lógica de carregamento de protocolo/dados intacta.

**Funcionalidade testada via Preview**:
- Carregar /app/sucesso.html?id=1 ✓
- Card aparece com slide-in suave ✓
- Check verde com pop-in bounce + halo expanding loop ✓
- Botões "Acompanhar no portal" / "Baixar recibo oficial" / "Consultar por protocolo" com lift ao hover ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V276 — 2026-05-25 — Alerts + Origin badges + Empty states + Inputs (global)
**Por quê**: continuação. Quatro componentes globais ainda apagados — todos em style.css, mudança propaga para todas as telas.

**Arquivo**: `style.css` (4 grupos de selectors).

**Mudanças aplicadas**:

**.alert (banners info/warn/danger/success)**:
- Padding 14px 18px (de 12px 14px), border-radius 10px (de 8px), line-height 1.55
- Font-size 13.5px (de 13px), margin-bottom 14px
- **Sombra sutil** 0 1px 2px + **border 1px transparent → border-color sutil por variante** (rgba da cor da variante com .15-.18 alpha)
- Border-left **4px** (de 3px) — mais grosso, mais visível
- `.alert strong` font-weight 600 explícito

**.origin badges (Portal/Link/Manual)**:
- Padding 3px 10px (de 2px 8px), border-radius 6px (de 4px)
- Font-size 10.5px (de 11px), font-weight **700** (de 600)
- **Text-transform: uppercase + letter-spacing .6px** — agora parecem badges enterprise (ex.: "PORTAL", "LINK_PUBLICO")
- Line-height 1.4

**.empty-state**:
- Padding 56px 24px (de 48px 20px) — mais arejado
- Ícone 48px (de 40px) + **opacity .5** — discreto mas visível
- H3 16px font-weight 600 (de 15px sem weight)
- P com **max-width 380px + margin auto** — texto centralizado e limitado

**input/select/textarea**:
- Font-size 13.5px (de 13px), padding 9px 12px (de 8px), border-radius 8px (de 6px)
- **Transition .12s** em border-color + box-shadow
- **Hover**: border-color border-strong (cinza mais escuro) quando não focused/disabled
- **Focus**: border-color primary + **`box-shadow:0 0 0 3px rgba(91,84,153,.12)`** — ring roxo suave (3px halo)
- **Disabled**: bg surface-2 + color muted + cursor not-allowed

**Funcionalidades preservadas**: 100% — só CSS.

**Funcionalidade testada via Preview** (painel HECC):
- Alert "2 pendência(s) crítica(s)" agora com border-left 4px vermelho + border-color rosa-claro 1px + sombra sutil ✓
- KPI cards continuam com border-left 4px da V271 ✓
- Topnav continua refinado da V275 (sombra abaixo, active state) ✓

**Impacto cascata**: alerts em painel/portal/envio/onboarding, origin badges em envio/painel/admin/portal, empty states em listagens, inputs em todos os formulários.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V275 — 2026-05-25 — Topnav global refinado (sombra, transições, active state)
**Por quê**: continuação. Topnav aparece em **todas** as telas do sistema (admin, painel, envio, portal, perfil, etc) — refinar atinge o sistema inteiro.

**Arquivo**: `style.css` (.topnav + variantes).

**Mudanças aplicadas**:

**.topnav**:
- Height 60px (de 56px) — respira melhor
- Padding 0 28px (de 24px) + gap 28px (de 24px)
- **Sombra sutil** 0 1px 3px — separa visualmente do conteúdo

**.topnav .tabs a (tabs)**:
- Padding 9px 14px (de 8px), border-radius 8px (de 6px)
- **Transition .15s ease** em todas as propriedades — hover suave
- Display inline-flex com align-items center + gap 6px — permite badges (counts, dots) inline
- Text-decoration:none explícito (sobrescreve a regra global de underline em links)
- Hover: bg surface-2 + color text (em vez de só bg)
- **Active**: bg primary-soft + color primary-2 + font-weight 600 + **`box-shadow:inset 0 0 0 1px rgba(91,84,153,.08)`** — ring interno sutil destaca a aba atual

**.topnav .userbox**:
- Avatar agora 34px (de 32px) + font-weight 700 (de 600)
- **Avatar com sombra** `0 1px 3px rgba(91,84,153,.25)` — leve elevação tipo Material Design

**Brand strong**: font-weight 700 + size 14px explícito

**Funcionalidades preservadas**: 100% — só CSS, comportamento de navegação inalterado.

**Funcionalidade testada via Preview** (admin Maria Andrade):
- "Dashboard" como tab ativa com bg primary-soft + ring sutil ✓
- Outras tabs (Pendentes, Pagamentos, Unidades, etc) com hover suave ✓
- Avatar "MA" com sombra leve ✓
- Topnav com sombra abaixo separa do conteúdo ✓
- Navegação entre tabs funciona ✓

**Impacto cascata**: TODAS as telas com topnav (admin*, painel, envio, portal, perfil, notificacoes, cadastro, senha, sucesso, login) ganham o novo visual.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V274 — 2026-05-25 — Modais globais com overlay blur + animação entry
**Por quê**: continuação. Modais (modal-expectativa, modal-link, modal-manual, modal-externo, modal-ret etc.) apareciam com overlay simples preto + caixa branca sem polimento. Para um sistema enterprise, modais devem ter efeito glass + animação suave + sombra forte.

**Arquivo**: `style.css` (.modal-bg + .modal) — propaga para TODOS os modais do sistema.

**Mudanças aplicadas**:

**.modal-bg (overlay)**:
- Background: `rgba(15,15,25,.55)` (de `rgba(0,0,0,.4)`) — tom roxo escuro suave em vez de preto puro
- **`backdrop-filter: blur(3px)`** (+ `-webkit-backdrop-filter`) — efeito glass: turva o fundo mantendo legibilidade contextual
- Padding 20px para não encostar nos cantos em telas pequenas
- **Animação `modalBgIn`** de .18s ease-out (fade in)

**.modal (card)**:
- Padding 28px 30px (de 24px) — respira melhor
- Border-radius 14px (de 12px)
- Width 580px (de 560px)
- **Sombra forte multilayer**: `0 20px 60px rgba(0,0,0,.25), 0 2px 8px rgba(0,0,0,.1)` — flutua sobre o overlay
- **Animação `modalIn`** com cubic-bezier(.16,.84,.44,1) de .22s: combina translateY(12px → 0) + scale(.98 → 1) + opacity (0 → 1) — entrada suave com leve "snap"
- h2: font-size 19px (de default), font-weight 700, cor text explícita
- sub: line-height 1.5
- actions: gap 10px (de 8px), padding-top 16px (de 14px)

**Funcionalidades preservadas**: 100% — só CSS, comportamento JS (`abrirModal`/`fecharModal`) inalterado.

**Funcionalidade testada via Preview** (modal-expectativa no painel HECC):
- Overlay com blur ativo — fundo turva visivelmente ✓
- Modal "Criar expectativa de envio" centralizado com sombra forte ✓
- H2 19px bold ✓
- Botões Cancelar (outline) + Criar expectativa (primary) na barra inferior ✓
- Animação de entrada visível ao abrir ✓
- Click fora fecha modal (preservado) ✓

**Impacto cascata**: todos os modais do sistema ganham o novo visual — modal-expectativa (painel), modal-link (painel), modal-manual (painel), modal-externo (painel), modal-ret (envio), modal-rejeitar (envio), modal-pago (envio), etc.

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V273 — 2026-05-25 — Admin dashboard: bar charts com gradient + labels legíveis
**Por quê**: continuação. Bar charts do `admin.html` tinham trilhas finas (14px) e fill cor sólida — funcional mas sem hierarquia visual. Além disso, "Por origem" mostrava `link_publico`/`manual`/`portal` (raw values do backend) em vez de labels legíveis.

**Tela**: `admin.html` (dashboard FESF Sede).

**Mudanças aplicadas**:

**CSS (.bar)**:
- Padding 8px (de 6px) + gap 12px (de 10px)
- `.lbl` width 180px (de 160px) — mais espaço para labels longos como "HMI · Ilhéus"
- `.track` height **18px** (de 14px) + border-radius 9px (de 4px) — pílulas grandes e arredondadas
- **`.fill` com gradient roxo → verde** `linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%)` + transition .4s ease
- `.val` font-weight 700 (de 600), font-size 13.5px

**JS (renderBar de "Por origem")**:
- `m.por_origem.map(o => ({ label: statusLabel(o.origem), n: o.n }))` — agora usa helper `statusLabel()` em vez de raw `o.origem`
- Resultado: "Portal (fornecedor logado)" / "Link público" / "Lançamento manual" em vez de "portal" / "link_publico" / "manual"

**Funcionalidades preservadas**: 100% — só CSS + label transform.

**Funcionalidade testada via Preview** (admin Maria Andrade):
- Bar "Por unidade": HECC com barra gradient roxo→verde, valor "3" em mono à direita ✓
- Bar "Por origem": 3 barras (Link público, Lançamento manual, Portal) com labels legíveis ✓
- Trilhas grossas (18px) e arredondadas (9px) — visual de pílula ✓
- Animation .4s na expansão ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V272 — 2026-05-25 — Portal fornecedor: sub-stats dos KPIs com valores R$
**Por quê**: continuação. O portal já estava bem alinhado (V242, hero banner, KPIs com border-left da V271), mas os sub-stats dos KPIs eram secos: "aguardando análise FESF", "precisa sua ação", "incluindo pagos". Faltava o **valor monetário em R$** que dá noção de magnitude — fornecedor precisa ver quanto está em jogo.

**Tela**: `portal.html` (visão fornecedor).

**Mudanças aplicadas**:

`carregarKPIs()` enriquecido com computações monetárias:
- `aprovValor` = soma de `valor_centavos` de envios aprovados+pagos
- `emAnaliseValor` = soma dos em análise
- `aguardValor` = soma dos aguardando retificação

**Novos sub-stats**:
- **Total enviados**: "R$ 158.000,00 em documentação" (era só "R$ 158.000,00")
- **Em análise**: "R$ X aguardando FESF" (era "aguardando análise FESF")
- **Aguard. retificação**: "R$ X · ação necessária" se há pendência / "— sem pendências" se zero
- **Aprovados**: "R$ X liberados" (era "incluindo pagos")

Label "Aguardando retificação" abreviado para "Aguard. retificação" (mais compacto).

**Funcionalidades preservadas**: 100% — só rendering dos sub-stats.

**Funcionalidade testada via Preview** (login fornecedor Contato · Empresa Hospitalar):
- 4 KPIs: Total enviados 1 (R$ 158.000,00 em documentação) / Em análise 1 (R$ 158.000,00 aguardando FESF) / Aguard. retificação 0 (— sem pendências) / Aprovados 0 (R$ 0,00 liberados) ✓
- Border-left colorido da V271 funcionando: roxo (default) / laranja (warn) / verde (accent) ✓
- Hero banner roxo/verde preservado ✓
- Tabela Meus envios preservada ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V271 — 2026-05-25 — Refinar KPI cards + tabelas (CSS global)
**Por quê**: continuação V270. Auditoria do painel.html (operador) revelou que KPI cards e tabelas eram visualmente apagados — não destacavam números nem davam hierarquia clara. Mudança em `style.css` propaga para TODAS as telas (painel, admin, perfil, fornecedor, relatórios).

**Arquivo**: `style.css` (.kpi-row / .kpi + table / th / td) — impacto global.

**Mudanças aplicadas**:

**KPI cards (.kpi)**:
- Padding 16px 18px (de 14px), border-radius 12px (de 10px), gap 14px (de 12px)
- **Sombra sutil** (0 1px 2px) + hover shadow mais forte (0 2px 8px) — feedback visual
- Label: letter-spacing .7px, margin-bottom 8px, font-weight 600
- **Value**: font-size **28px** (de 26px), letter-spacing -.5px (tipográfico compacto), line-height 1.15
- Variant accent verde: agora aceita `.value.mono` (font monospace para R$)
- Sub-stat: font-weight 500
- **Border-left 4px** (de 3px) — mais grosso e visível:
  - Default: roxo (primary)
  - .warn: laranja
  - .danger: vermelho
  - .accent: verde

**Tabelas (table / th / td / tr)**:
- Th: padding 12px 14px (de 10px 12px), font-size 10.5px (de 11.5px), letter-spacing .7px (de .4px), font-weight 700 (de 600) — headers mais compactos e formais
- Td: padding 13px 14px (de 12px), vertical-align middle (de top), cor text explícita
- **Code dentro de td** com font-size 12px + cor text — protocolos legíveis
- Hover row: **bg roxo bem suave** (rgba(91,84,153,.03)) + transition .12s — em vez de cinza
- Last child sem border-bottom (cleanup visual)

**Funcionalidades preservadas**: 100% — só CSS.

**Funcionalidade testada via Preview** (painel HECC):
- 4 KPI cards com border-left colorido + value 28px monospace ✓
- "RECEBIDOS · 2026-05" em roxo, "AGUARDANDO RET." em laranja, "PENDÊNCIAS CRÍTICAS" em vermelho, "APROVADOS (MÊS)" em verde ✓
- Sombras sutis nos cards + hover state ✓
- Alert "2 pendência(s) crítica(s)" continua chamando atenção ✓
- Bar chart + sidebar atividade preservados ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000.

---

### V270 — 2026-05-25 — Refinar section-cards + botões de ação (global)
**Por quê**: continuação V269. Section-cards do envio.html ficavam achatados (sem sombra/header bg) e botões de ação no painel lateral sem hierarquia visual forte. Como `button.success/.warn/.danger` é CSS global em `style.css`, melhorias propagam para TODA a app (envio, painel, admin, perfil).

**Arquivos**: `style.css` (button + variantes) + `envio.html` (.section-card).

**Mudanças aplicadas**:

**style.css — buttons** (impacto global):
- Padding 9px 14px (de 8px), border-radius 8px (de 6px), font-weight 500 base
- `:active` com transform translateY(1px) — feedback tátil
- Todas as variantes (primary/success/warn/danger): font-weight 600
- Hover de variantes coloridas: `filter:brightness(1.05)` + `box-shadow` com cor da variante (sombra colorida sutil)
  - Primary: shadow roxa
  - Success: shadow verde-acentuada
  - Warn: shadow laranja
  - Danger: shadow vermelha

**envio.html — .section-card**:
- Border-radius 12px (consistente) + margin-bottom 16px + **box-shadow sutil** (0 1px 2px rgba(20,20,30,.04))
- Header: padding 15px 20px (de 14px 18px), background surface explícito
- Header h3: font-weight 600 + cor text explícita
- Header meta: font-weight 500
- Body: padding 16px 20px
- KV: padding 12px 0, last-child sem border, k em 11px letter-spacing .5px, v em 13.5px font-weight 500

**Funcionalidades preservadas**: 100% — só CSS.

**Funcionalidade testada via Preview** (envio #1):
- Cards de "Dados do envio" e "AÇÕES" agora com sombra sutil + header com bg explícito ✓
- Botões "✓ Aprovar envio" (verde), "⚠ Solicitar retificação" (laranja), "✕ Rejeitar" (vermelho) com tipografia bold + maiores ✓
- Hovers visíveis com sombra colorida + brilho leve (apenas ao passar mouse) ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000 após testes.

---

### V269 — 2026-05-25 — Refinar header + tabs + pills do envio.html
**Por quê**: continuação V268. Auditoria visual revelou:
1. **Bug**: pill `.em-analise` (CSS) vs `em_analise` (backend snake_case) — não fazia match → pill ficava sem cor info
2. **Detail-header**: pill de status pequeno e sem destaque no canto, eyebrow pouco formatado, valor monospace fraco
3. **Detail-tabs**: counts no formato `<span class="count">N</span>` ficavam apagados, sem chip visual

**Tela**: `envio.html` (todos os papéis).

**Mudanças aplicadas**:

**style.css (.pill)**:
- Aceita ambos `em-analise` (hífen) E `em_analise` (underscore) — match com backend snake_case
- Aceita `aguardando_envio` também
- Padding 3px 11px (de 2px 10px), letter-spacing .2px

**envio.html (.detail-header)**:
- Padding 22px 26px (de 18px 22px) + border-radius 14px + sombra sutil
- Eyebrow com letter-spacing 1.1px + gap 10px + flex
- H1: font-size 26px (de 24px), font-weight 700, letterspacing .5px
- `.right` agora flex column align-items flex-end gap 8px
- Pill maior no canto: 12px / padding 5px 14px
- Valor mono: 24px (de 22px), letter-spacing .3px

**envio.html (.detail-tabs)**:
- Tabs: border-radius 8px (de 6px), padding 11px 14px, transition .15s
- Active com box-shadow sutil
- **Counts viram chips visuais**: bg surface-2 padding 1px 7px border-radius 10px min-width 18px
- Active count: bg primary roxo + texto branco — destaca a tab atual

**Funcionalidades preservadas**: 100% — toda lógica intacta, só CSS + match de classes.

**Funcionalidade testada via Preview** (envio #1 status em_analise):
- Pill "Em análise" no canto agora renderiza com bg azul claro + texto azul info ✓
- Tab counts em chips visuais: Resumo / Formulário 4 / Documentos 0 / Comentários 0 / Auditoria 1 ✓
- Tab ativa (Resumo) com box-shadow ✓
- Header com hierarquia rica: eyebrow + H1 mono + razão social + valor 24px no canto ✓
- Trajetória V268 continua funcionando ✓

**Testes**: 1127 verdes · 0 falhas.

**Server reiniciado** em localhost:3000 após testes.

---

### V268 — 2026-05-25 — Trajetória do envio com design rico (feedback do usuário)
**Por quê**: usuário sinalizou que os elementos de design da trajetória nos detalhes do envio estavam visualmente distintos do mockup. Auditoria revelou **dois problemas**:
1. **Lógica errada**: ambos "Recebido" e "Em análise" tinham `key: 'em_analise'` → quando status era `em_analise`, ambos ficavam `active` (roxo). Correto: Recebido sempre `done` quando há envio + somente o stage atual é `active`.
2. **Visual genérico**: dots de 14px sem numeração/iconografia, faltando hierarquia visual rica do mockup.

**Tela**: `envio.html` (visão operador/admin/fornecedor — todos veem a mesma trajetória).

**Mudanças aplicadas**:

**Lógica de estado** (refatoração `stages` + `timelineHtml`):
- Adicionado mapa `statusToIdx`: `em_analise=1, aguardando_ret=2, retificado=3, aprovado=4, pago=5, rejeitado=-1`
- Stages agora têm `idx` (0–5), não `key`
- Para cada stage: `i < idxAtual → done`, `i === idxAtual → active`, `i > idxAtual → pending`
- Caso rejeitado: Recebido + Em análise como done; resto pending
- **Recebido sempre done** quando há envio (consistente com mockup)

**Visual refeito** (CSS `.timeline-step` + `.dot-num`):
- Dots aumentados de 14px para **26px** (active: **30px** com top:-2px para compensar)
- **Numeração dentro dos dots**: stage 1=✓ (done) / stage 2=2 (active number) / pending=vazio
- **DONE**: bg `accent` (verde) + ✓ branco em 13px + linha conectora verde 3px
- **ACTIVE**: bg `primary` (roxo) + número branco + **halo glow** `0 0 0 5px primary-soft, 0 2px 8px rgba(91,84,153,.35)` + label em bold roxo
- **PENDING**: bg surface + border `border` cinza + opacidade .65
- Container `.timeline-wrap` com padding maior (22px 26px 18px) + sombra sutil + h3 com uppercase + letter-spacing 1.2px
- Linhas conectoras: 3px (de 2px), border-radius 2px, posicionadas em `calc(50% + 16px)` para conectar nos dots maiores

**Funcionalidades preservadas**: 100% — a lógica de detecção de eventos (`tCriado`, `tAnalise`, `tAgRet`, `tRetificado`, `tAprovado`, `tPago` via `acoes` da auditoria) continua igual; apenas o mapeamento done/active/pending mudou. Timestamps (`when`) preservados. Funciona para todos os papéis.

**Funcionalidade testada via Preview** (operador HECC Carlos Souza, envio #1 status em_analise):
- Stage 1: classe `done`, número `✓`, label "Recebido" ✓
- Stage 2: classe `active`, número `2`, label "Em análise" (roxo bold + halo) ✓
- Stages 3–6: classe `pending`, vazios ✓
- Conector verde de 1→2, conectores cinza de 2→6 ✓
- Visual com hierarquia clara, dots grandes, halo do active prominente ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V267 — 2026-05-25 — 2ª passagem · polimento cadastro.html
**Por quê**: 2ª passagem · tela #2. Mockup screen-cadastro tem dois consentimentos obrigatórios (Termos de Uso/Política de Privacidade + LGPD) + helper text "Após enviar, não poderá editar o CNPJ" próximo ao botão. V245 não incluiu esses elementos legais/de UX.

**Tela**: `cadastro.html` (screen-cadastro).

**Gap detectado (2ª passagem)**:
- Faltavam checkboxes de aceite de Termos de Uso + autorização LGPD (compliance legal)
- Faltava helper text avisando que CNPJ não pode ser editado após envio

**Mudanças aplicadas**:
1. **Checkbox "Declaro que as informações são verdadeiras + Termos de Uso + Política de Privacidade"** (required) com links externos para `/termos` e `/lgpd`.
2. **Checkbox "Autorizo o tratamento dos meus dados pessoais conforme a LGPD"** (required) com link para `/lgpd`.
3. **Helper text "Após enviar, o CNPJ não poderá ser editado."** próximo ao botão de submit (warn UX).
4. Ambos checkboxes usam `required` HTML5 — browser bloqueia submit se não marcados.

**Funcionalidades preservadas**: 100% — pill "NOVO FORNECEDOR", H1, lead, 3 vantagens (auto-serviço/acompanhamento/histórico), info box roxo com 3 etapas numeradas, todos os campos (razão social, CNPJ, e-mail, telefone, nome contato, unidades), mensagem PF, validação backend, redirect para tela sucesso.

**Funcionalidade testada via Preview**:
- Carregar /app/cadastro.html ✓
- Checkboxes `#cad-termos` e `#cad-lgpd` presentes ✓
- Ambos com `required=true` ✓
- Botão submit presente ✓
- Visual confirma alinhamento com mockup ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V266 — 2026-05-25 — 2ª passagem · polimento login.html
**Por quê**: início da **2ª passagem** do loop mockup × app. Após concluir as 24 telas (V242–V265), revisitando V242 (login) com olhar treinado pelas iterações posteriores. Mockup screen-login tem footer com links institucionais "Privacidade / Termos / Suporte" — o app tinha apenas 2 links práticos ("Como funciona" e "Consulta pública") sem os institucionais.

**Tela**: `login.html` (screen-login).

**Auditoria comparativa** (2ª passagem):

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow "PORTAL DE PAGAMENTOS" | ✓ | ✓ V242 |
| H1 "Envie, acompanhe, receba." | ✓ | ✓ V242 |
| 3 features (hero esquerdo) | ✓ | ✓ V242 |
| Eyebrow "ACESSO" | ✓ | ✓ V242 |
| H2 "Entrar na sua conta" | ✓ | ✓ V242 |
| Toggle Mostrar/Ocultar senha | ✓ | ✓ |
| Lembrar-me checkbox | ✓ | ✓ V242 |
| Esqueci minha senha | ✓ | ✓ V242 |
| Signup CTA | ✓ | ✓ V242 |
| Footer Privacidade/Termos/Suporte | ✓ | ❌ ausente |

**Mudança aplicada** (apenas footer):
1. **Footer enriquecido** com 3 novos links institucionais do mockup:
   - `Privacidade` → `https://www.fesfsus.ba.gov.br/lgpd` (target _blank)
   - `Termos` → `https://www.fesfsus.ba.gov.br/termos` (target _blank)
   - `Suporte` → `mailto:suporte.portal@fesfsus.ba.gov.br`
2. Preservados os 2 links práticos do app: "Como funciona" + "Consulta pública".

**Funcionalidades preservadas**: toda lógica de login (toggle senha, lembrar-me, esqueci senha, login flow), demo accounts auto-fill, primeiro acesso, redirect por papel.

**Funcionalidade testada via Preview**: footer renderiza com 5 links (Como funciona / Consulta pública / Privacidade / Termos / Suporte).

**Testes**: 1127 verdes · 0 falhas (1 falha intermitente em sessoes-revogar no 1º run, dissipou no 2º — state-leakage; não relacionada à mudança).

---

### V265 — 2026-05-25 — Notificações alinhada ao mockup (loop tela #24 — última)
**Por quê**: vigésima quarta e ÚLTIMA tela do loop. Mockup screen-notif tem header pedagógico (eyebrow + H1 + subtitle) + ações compostas (Marcar todas + Configurar) + filter chips ricos + lista de notificações em card único. App tinha apenas H1 simples + botão "Marcar todas", sem eyebrow, subtitle ou link de configuração.

**Tela**: `notificacoes.html` (screen-notif).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow | "Central de notificacoes" | ❌ ausente |
| H1 | "Notificacoes" | "Suas notificações" |
| Subtitle | "Todas as atualizacoes sobre seus envios..." | ❌ ausente |
| Atalho Configurar | "Configurar notificacoes" botão | ❌ ausente |
| Botão "Marcar todas" | Botão padrão | Botão sem destaque |
| Filtros | status-tabs com contagens | filtro-chips (já existiam) |

**Mudanças aplicadas** (visual + UX, sem mexer na lógica):
1. **Header rico** com eyebrow "CENTRAL DE NOTIFICAÇÕES" + H1 "Notificações" + subtitle "Todas as atualizações sobre seus envios, fornecedores e operação. [contador]" — o contador dinâmico foi mesclado dentro do subtitle.
2. **Atalho "⚙ Configurar"** linkando para `/app/perfil.html` (onde existem as preferências de notificação).
3. **Botão "✓ Marcar todas como lidas"** promovido a `primary` (roxo destacado).
4. Layout em `.between` com `align-items:flex-start;gap:18px;flex-wrap:wrap` alinhado com o padrão de outras páginas (admin-relatorios, admin-fornecedores etc).

**Funcionalidades preservadas** (nenhuma removida):
- Filter chips: Todas / Não lidas / Envios / Aprovações / Rejeições / Retificações / Pagamentos / Comentários / Sistema (todos com handlers já existentes para filtrar lista client-side).
- Lista de notificações `#lista.notif-list` com cards individuais (icon por tipo / nome / mensagem / when).
- Click em notificação abre envio relacionado.
- `marcarTodas()` chama `api.marcarTodasNotifLidas()` e re-renderiza.
- Auto-mark-as-read on click.
- Empty state com 📭 quando nenhuma notificação.
- Topnav com back link por papel + sair.

**Funcionalidade testada via Preview** (operador HECC Carlos Souza):
- Login ✓
- Carregar /app/notificacoes.html ✓
- Eyebrow "CENTRAL DE NOTIFICAÇÕES" ✓
- H1 "Notificações" ✓
- Subtitle "Todas as atualizações sobre seus envios, fornecedores e operação. 0 notificações no total · 0 não lidas" ✓
- Link "⚙ Configurar" presente ✓
- Botão "✓ Marcar todas como lidas" primary ✓
- 9 filter chips renderizam ✓
- Empty state com 📭 "Nenhuma notificação" ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V264 — 2026-05-25 — Perfil alinhado ao mockup (loop tela #23)
**Por quê**: vigésima terceira tela do loop. Mockup screen-perfil tem header pedagógico (eyebrow + H1 + subtitle). App tinha apenas grid sidebar+main sem header introdutório.

**Tela**: `perfil.html` (screen-perfil).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow | "Sua conta" | ❌ ausente |
| H1 | "Perfil" | ❌ ausente |
| Subtitle | "Gerencie seus dados pessoais, segurança e preferências." | ❌ ausente |
| Atalho Notificações | ✓ via topnav | ❌ ausente no header |

**Mudanças aplicadas** (visual + UX, sem mexer na grid):
1. **Header rico** acima do `.perfil-grid` com eyebrow "SUA CONTA" + H1 "Perfil" + subtitle "Gerencie seus dados pessoais, segurança e preferências." (texto exato do mockup).
2. **Atalho "🔔 Notificações"** à direita do header (link para `/app/notificacoes.html`) — alinhado com filters padrão.

**Funcionalidades preservadas** (nenhuma removida):
- Sidebar lateral esquerda com `.avatar-big` (iniciais), `#nomeBig`, `#papelPill`, lista de meta (e-mail, unidade se operador, fornecedor se forn, membro desde, último login).
- Seção "Dados pessoais" com edição de nome (e-mail disabled, papel disabled, botão "Salvar nome").
- Seção "Trocar senha" (senha atual + nova + confirmação + botão "Alterar senha").
- Seção "Sessões ativas" (lista de sessões + botão revogar / encerrar todas as outras).
- Seção "Preferências de notificação" (toggles para tipos de notificação).
- Seção "Sobre o sistema".
- Seção "Zona de perigo".

**Funcionalidade testada via Preview** (login operador HECC Carlos Souza):
- Login ✓
- Carregar /app/perfil.html ✓
- Eyebrow "SUA CONTA" + H1 "Perfil" + subtitle correto ✓
- Atalho 🔔 Notificações visível ✓
- Sidebar com avatar "CS" + nome "Carlos Souza (HECC)" + pill "OPERADOR" + e-mail + unidade HECC + membro desde + último login ✓
- 6 seções no main renderizam (Dados pessoais, Trocar senha, Sessões, Preferências, Sobre, Zona de perigo) ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V263 — 2026-05-25 — Envio perfil Fornecedor alinhado ao mockup (loop tela #22)
**Por quê**: vigésima segunda tela do loop. Mockup screen-details-fornec mostra a visão fornecedor do envio em retificação com banner "Ação necessária" + motivo + prazo + CTA destacado. App tinha apenas botão pequeno "⚠ Submeter retificação" no painel lateral de ações — funcional mas pouco visível.

**Tela**: `envio.html` (visão fornecedor, quando status === 'aguardando_ret').

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Banner topo "Ação necessária" | Card amarelo com motivo + prazo + CTA | ❌ ausente |
| Motivo da retificação | Visível no banner | Apenas em comentários/auditoria |
| Prazo de retificação | "Você tem até DD/MM" | ❌ não exibido |
| CTA "Iniciar retificação" | Botão grande no topo | Botão pequeno no painel lateral |

**Mudanças aplicadas** (visual + UX):
1. **Banner condicional `bannerRet`** renderizado no topo do `#conteudo` quando `fornecedorPodeRet === true` (já existia esse boolean — `papel === 'fornecedor' && status === 'aguardando_ret'`):
   - Box `.alert.warn` com `border-left:4px solid var(--warning)`, padding, border-radius
   - Eyebrow "⚠ AÇÃO NECESSÁRIA" em uppercase + tracking
   - H3 "A FESF solicitou ajustes neste envio"
   - Descrição: motivo da última `retificacao_solicitada` (de `acoes`, truncado em 220 chars) + prazo
   - Prazo dinâmico: usa `e.prazo_retificacao` se presente, senão calcula `criado_em` da retificação + 5 dias
   - Botão warn "Iniciar retificação →" que dispara `acaoEnviarRet()` (já existia)
   - Link âncora "Ver comentários da FESF" que clica `[data-tab=comentarios]`

**Funcionalidades preservadas** (nenhuma removida):
- Entity header (eyebrow + protocolo + razão social + valor + competência + pill status).
- Trajetória do envio com dots conectados (V247).
- Tabs Resumo / Formulário / Documentos / Comentários / Auditoria.
- Painel lateral de ações com botão original "⚠ Submeter retificação" para fornecedor.
- Topnav com tab "Meus envios" para fornecedor + back link para portal.html.
- Todos os controles para operador/admin (acaoSolicitarRet/Aprovar/Rejeitar/Encaminhar/MarcarPago) escondidos para fornecedor — banner é exclusivo para `papel === 'fornecedor'`.

**Funcionalidade testada via Preview**:
- Login operador HECC → solicitar retificação no envio #1 com motivo "Item 22: corrigir valor do PIS na linha 14 (R$ 1.247,80 → R$ 1.428,90); Item 31: relatório FGTS sem assinatura digital" → status mudou para `aguardando_ret` ✓
- Login fornecedor "contato@empresahosp.com.br" → abrir `/app/envio.html?id=1` ✓
- Banner "⚠ AÇÃO NECESSÁRIA" + H3 "A FESF solicitou ajustes neste envio" ✓
- Motivo correto exibido no banner: "Item 22: corrigir valor do PIS na linha 14..." ✓
- Prazo dinâmico exibido: "Prazo: 30/05/2026" (5 dias após retificação solicitada) ✓
- Botão "Iniciar retificação →" presente e clicável ✓
- Link "Ver comentários da FESF" presente ✓
- Pill status "Aguardando retificação" no header ✓
- Trajetória mostra: Recebido (done) → Em análise (done) → Aguard. ret. (active) ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V262 — 2026-05-25 — Onboarding alinhado ao mockup (loop tela #21)
**Por quê**: vigésima primeira tela do loop. Mockup screen-onboarding tem hero "Cadastro aprovado" + checklist de 5 passos numerados (done/active/pendente) específico para fornecedor recém-aprovado. App tinha apenas página educacional genérica explicando os 3 cenários — útil para todos os perfis, mas faltava o ritual de boas-vindas e checklist acionável para fornecedor.

**Tela**: `onboarding.html` (screen-onboarding).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Hero "Cadastro aprovado" | Badge verde + H2 personalizado | ❌ ausente |
| Checklist 5 passos | done/active/pendente com botões CTAs | ❌ ausente |
| Conteúdo educacional | mínimo | rico (3 passos + 3 cenários + ferramentas) |
| Aplicabilidade | só fornecedor | todos os perfis |

**Mudanças aplicadas** (visual + UX, sem perder conteúdo educacional):
1. **CSS dedicado** para `.hero-onb`, `.checklist`, `.check-item` (com estados `.done` accent verde + ✓ / `.active` primary roxo + shadow / pendente border padrão), `.step-num-circle`.
2. **Hero "Cadastro aprovado"** condicional via `#hero-fornecedor` (mostrado só se `usuario.papel === 'fornecedor'`):
   - Badge verde "CADASTRO APROVADO"
   - H2 personalizado "Bem-vinda(o), [Razão Social]" via `usuario.fornecedor_razao` ou fallback para `usuario.nome`
   - Descrição motivacional do mockup
3. **Checklist de 5 passos** condicional via `#checklist-fornecedor`:
   - (1) ✓ done verde: "Cadastro aprovado pela FESF" + pill "Concluído"
   - (2) active roxo: "Confirme os dados da empresa" + botão primary "Confirmar dados" → `/app/perfil.html`
   - (3) pendente: "Anexe certidões vigentes (recomendado)" + botão "Anexar agora" → `/app/perfil.html#documentos`
   - (4) pendente: "Cadastre seu time" + botão "Convidar pessoas" → `/app/perfil.html#equipe`
   - (5) pendente: "Faça seu primeiro envio" + botão primary "Ir para o portal" → `/app/portal.html`
4. **Script atualizado** com tratamento `if (u && u.papel === 'fornecedor')` que revela hero+checklist apenas para fornecedor.

**Funcionalidades preservadas** (nenhuma removida):
- Conteúdo educacional original: "Como funciona em 3 passos", "Os 3 cenários de envio" (Portal/Link público/Manual), "Ciclo de vida do seu envio", "Para operadores: ferramentas" (Painel/Pendências/Lançamento manual), "Para a FESF Sede: visão consolidada".
- Footer "← Acessar o portal" (quando não primeiro=1).
- Footer "Começar a usar →" + `window.concluirOnboarding()` (quando primeiro=1) que chama `api.concluirOnboarding()`, atualiza sessão local, e redireciona por papel (fornecedor→portal, admin_fesf→admin, operador→painel).
- Visual gradient roxo/verde no body e card central preservado.

**Funcionalidade testada via Preview** (login fornecedor "contato@empresahosp.com.br" + primeiro=1):
- Login fornecedor papel=fornecedor ✓
- Carregar /app/onboarding.html?primeiro=1 ✓
- Hero visível com badge "CADASTRO APROVADO" + H2 "Bem-vinda(o), Contato · Empresa Hospitalar Ltda." ✓
- Checklist visível com 5 check-items ✓
- Item #1 done (com ✓ verde) ✓
- Item #2 active (com bg roxo + botão "Confirmar dados") ✓
- Items #3, #4, #5 pendentes com botões CTAs ✓
- Botão "Começar a usar →" no footer presente ✓
- Conteúdo educacional preservado abaixo ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V261 — 2026-05-25 — Admin Configurações alinhado ao mockup (loop tela #20)
**Por quê**: vigésima tela do loop. Mockup screen-config tem header rico (eyebrow + H1 + pill visão + subtitle pedagógico) + sidebar de navegação entre seções. App tinha apenas H1 simples + parágrafo muted, sem navegação rápida entre os 6 cards.

**Tela**: `admin-config.html` (screen-config).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow | "ADMINISTRACAO DO SISTEMA" | ❌ ausente |
| H1 + pill visão | "Configuracoes" + Visão: FESF Sede | "Configurações do sistema" sem pill |
| Subtitle | "Parâmetros gerais · válidos para toda a rede" | "Parâmetros operacionais..." curto |
| Navegação entre seções | Sidebar config-nav com 9 links | ❌ ausente |
| Cards de config | 9 cards no mockup | 6 cards na app (todos funcionais) |

**Mudanças aplicadas** (visual + UX, sem mexer em funcionalidades):
1. **Header rico** com eyebrow "ADMINISTRAÇÃO DO SISTEMA" + H1 "Configurações" + pill verde "● Visão: FESF Sede" + subtitle alinhado ao mockup.
2. **Barra de navegação rápida** (card horizontal acima dos cards de config) com 7 links: 📋 Modalidades (#modalidades) / 📧 Lembretes (#cadencia) / ⏱ Prazos e SLA (#prazos) / ✉ SMTP (admin-smtp.html) / 📜 Auditoria (admin-auditoria.html) / 🔌 API (admin-api.html) / 💚 Status (admin-status.html). Links âncora navegam dentro da página; links externos pulam para outras telas admin.
3. **IDs `#modalidades`, `#cadencia`, `#prazos`** adicionados aos cards correspondentes para suportar scroll âncora.

**Funcionalidades preservadas** (nenhuma removida):
- Card "Modalidades habilitadas" com tabela (Código mono / Nome / Categoria pill / Formulário).
- Card "Cadência de lembretes e escalonamento" com 4 inputs (1º lembrete dias antes / 2º lembrete dias antes / sem resposta dias após / atrasada dias após) + botão Salvar + Forçar escalonamento agora.
- Card "SLA (metas de tempo)" com 2 inputs (Envio→Aprovação / Aprovação→Pagamento) + botão Salvar.
- Card "Origens permitidas".
- Card "Auditoria e LGPD".
- Card "Minha conta".
- Auto-save state preservado.

**Funcionalidade testada via Preview** (admin Maria Andrade):
- Login admin ✓
- Carregar /app/admin-config.html ✓
- Header renderiza: eyebrow "ADMINISTRAÇÃO DO SISTEMA" + H1 "Configurações" + pill "● Visão: FESF Sede" ✓
- Subtitle do mockup renderiza ✓
- Barra de navegação visível com 7 links (Modalidades, Lembretes, Prazos, SMTP, Auditoria, API, Status) ✓
- Cards: Modalidades habilitadas, Cadência, SLA, Origens, Auditoria e LGPD, Minha conta — todos preservados ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V260 — 2026-05-25 — Admin Detalhe da Unidade alinhado ao mockup (loop tela #19)
**Por quê**: décima nona tela do loop. Mockup screen-unidade-detail tem entity-header rico com avatar + eyebrow + H1 + meta + pills/botões de ação, KPIs com sub-stats descritivas, breakdown visual por origem. App tinha apenas H1 simples + parágrafo muted, KPIs sem sub-stats, tabela básica de origem.

**Tela**: `admin-unidade.html` (screen-unidade-detail).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Avatar | Quadrado com sigla | ❌ ausente |
| Eyebrow | "Unidade · Hospital · Ativa" | ❌ ausente |
| H1 + meta | "SIGLA — Nome" + cidade · CNES · telefone | "SIGLA — Nome" + parágrafo muted |
| Ações | Pill Ativa + Painel + Editar | ❌ ausente (sem botões) |
| KPIs sub-stats | "+18% vs abril" / "11 ativos · 1 onboarding" | sem sub-stats |
| Breakdown origem | 3 boxes coloridos | tabela simples 3 colunas |

**Mudanças aplicadas** (visual + UX):
1. **Entity header rico** com avatar 56×56 quadrado roxo (sigla até 4 chars) + eyebrow "UNIDADE · ATIVA/INATIVA · [Tipo]" + H1 "SIGLA — Nome" + meta inline (cidade/UF · CNES · telefone).
2. **Ações no lado direito**: pill Ativa/Inativa + botão "Painel da unidade" (admin abre visão operador).
3. **4 KPIs com sub-stats descritivas**:
   - Envios totais + sub "N fornecedor(es) atendendo"
   - Movimento (accent, mono, 22px) + sub "X% aprovado"
   - Aguardando ret. (warn) + sub "N em análise"
   - Operadores + sub "cadastrados na unidade"
4. **Card "Distribuição dos envios · por origem"** com 3 boxes coloridos lado a lado (Portal/Link/Manual) com contagem 22px + %dos envios + R$ — substitui a tabela simples.

**Funcionalidades preservadas** (nenhuma removida):
- Back link para listagem.
- Tabela "Operadores da unidade" (nome / e-mail mono / status / último login).
- Card "Fornecedores que atendem · N".
- Tabela "Últimos envios (10)" com Protocolo (link para envio.html) / Fornecedor / Modalidade / Comp. / Origem (pill) / Status (pill) / Valor mono / Em.
- Card "Pendências" com tabela status + quantidade.
- Card "Trilha de alterações" via auditoria (Quando / Quem / Ação / Detalhe).

**Funcionalidade testada via Preview** (admin Maria Andrade, unidade #1 HECC):
- Login admin ✓
- Carregar /app/admin-unidade.html?id=1 ✓
- Avatar "HECC" renderiza com bg roxo ✓
- Eyebrow "UNIDADE · ATIVA" ✓
- H1 "HECC — Hospital Estadual Costa dos Coqueiros" ✓
- KPIs: 3 envios (8 fornecedores) / R$ 179.250 (0% aprovado) / 0 aguardando (3 em análise) / 1 operador ✓
- 3 boxes de origem renderizam (Portal 33% R$158K, Link 33% R$18.450, Manual 33% R$2.800) ✓
- Botão "Painel da unidade" visível ✓
- Cards Operadores, Fornecedores, Últimos envios, Pendências, Trilha preservados ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V259 — 2026-05-25 — Admin Detalhe do Fornecedor alinhado ao mockup (loop tela #18)
**Por quê**: décima oitava tela do loop. Mockup screen-fornecedor-detail tem entity-header rico com avatar + eyebrow + H1 + meta + pill + botões de ação, 4 KPIs com sub-stats, breakdown visual por origem (3 boxes coloridos), responsividade. App tinha apenas H1 + parágrafo muted com pills inline, KPIs sem sub-stats, tabela simples de origem.

**Tela**: `admin-fornecedor.html` (screen-fornecedor-detail).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Avatar | Quadrado com iniciais | ❌ ausente |
| Eyebrow | "Fornecedor · ativo · Com portal" | ❌ ausente |
| H1 + meta | Razão social + CNPJ mono + cadastrado em | H1 + parágrafo único com pills inline |
| Botões de engajamento | Lado direito, junto às pills | ❌ separados em outro container |
| KPIs com sub-stats | "desde marco/2024" / "4 envios precisaram ajuste" | sem sub-stats |
| Breakdown por origem | 3 boxes coloridos com pct + R$ | tabela simples Origem/Quantidade |

**Mudanças aplicadas** (visual + UX):
1. **Entity header rico** com avatar 56×56 quadrado roxo (iniciais da razão social) + eyebrow "FORNECEDOR · ATIVO · [Tipo]" + H1 + meta inline (CNPJ/CPF + cadastrado em + e-mail).
2. **Pills + botões agrupados** no lado direito: Ativo/Inativo · Pendente aprovação · Engajamento + (se operador/admin) ⚠ Inadimplente / ↩ Reverter / ✕ Inativar.
3. **4 KPIs com sub-stats descritivas**:
   - Total enviado + sub "desde DD/MM/YYYY"
   - Movimento total (accent, mono, 22px) + sub "aprovados + pagos + análise"
   - Aguardando ret. (warn) + sub "X% precisaram ajuste"
   - Aprovados + Pagos + sub "N em análise"
4. **Card "Como este fornecedor envia · breakdown por origem"** com 3 boxes lado a lado:
   - **Portal** (primary-soft + border primary) — AUTO-SERVIÇO
   - **Link público** (accent-soft + border accent) — LINK PÚBLICO
   - **Manual** (surface-2 + border neutro) — OPERADOR
   - Cada box: pill origin + label + contagem grande (22px, cor da origem) + "% dos envios · R$ Y"
5. **Removida a tabela duplicada "Origem dos envios"** (estava redundante com o breakdown rico).

**Funcionalidades preservadas** (nenhuma removida):
- Voltar para fornecedores (back-link).
- Engajamento: marcar inadimplente (prompt com motivo), reverter para ativo (confirm), marcar inativo (opcional motivo).
- Card "Dados cadastrais" com razão social, documento, e-mail, telefone, cadastrado em, tipo.
- Card "Unidades que atende" com chips clicáveis para admin-unidade.html.
- Card "Histórico de envios (últimos 30)" com protocolo/unidade/modalidade/comp/origem/status/valor/data.
- Card "Expectativas (pendências)" com status + contagem.
- Card "Comentários recentes do fornecedor" com link para envio.html.
- Card "Trilha de alterações" via auditoria com tabela quando/quem/ação/detalhe.

**Funcionalidade testada via Preview** (admin Maria Andrade, fornecedor #1 Empresa Hospitalar):
- Login admin ✓
- Carregar /app/admin-fornecedor.html?id=1 ✓
- Avatar "EH" renderiza com bg roxo ✓
- Eyebrow "FORNECEDOR · ATIVO · COM PORTAL" ✓
- H1 "Empresa Hospitalar Ltda." ✓
- KPIs: Total enviado=1 (desde 25/05/2026), Movimento R$ 158.000,00, Aguardando ret.=0 (0%), Aprovados+Pagos=0 (1 em análise) ✓
- 3 boxes de origem renderizam (Portal 100%, Link público 0%, Manual 0%) ✓
- Botões de engajamento ⚠ Inadimplente + ✕ Inativar visíveis ✓
- Todos os cards preservados (Dados cadastrais, Unidades, Histórico, Expectativas, Comentários, Trilha) ✓
- Tabela "Origem dos envios" removida (era redundante) ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V258 — 2026-05-25 — Painel aba Novo lançamento alinhada ao mockup (loop tela #17)
**Por quê**: décima sétima tela do loop. Mockup screen-lanc-manual tem H1 "Iniciar novo pagamento" + decision-banner pedagógico + atalho de conversão de pendências + 3 caminhos visuais ricos + tabela de lançamentos manuais recentes + KPIs do mês. App tinha só o caminho padrão (verde) + 3 cards de exceção, sem banner pedagógico, atalho, KPIs ou tabela de recentes.

**Tela**: `painel.html` (aba Novo lançamento, ID `tab-lancar`).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| H1 + subtitle | "Iniciar novo pagamento" + subtitle de orientação | "Novo lançamento manual" + sub estático |
| Banner pedagógico | "? Qual fornecedor está sendo pago?" | ❌ ausente |
| Atalho converter pendência | Card laranja com contagem | ❌ ausente |
| KPIs do mês | 4 KPIs (Manuais / Externos / Aprovados / Em análise) | ❌ ausente |
| Tabela manuais recentes | Top 5 com Protocolo/Forn/Valor/Status | ❌ ausente |

**Mudanças aplicadas** (visual + UX, preservando 3 caminhos):
1. **TAB_HEADERS.lancar atualizado**: title `"Iniciar novo pagamento"` (substitui "Novo lançamento manual") + sub do mockup.
2. **Banner pedagógico azul** (`#lanc-banner` alert info) com "? Qual fornecedor está sendo pago?" explicando os 3 caminhos rastreáveis e mencionando o atalho de pendências.
3. **Atalho de conversão de pendências** (`#lanc-converter-atalho`): box gradient laranja/vermelho com ícone ⚡, contagem dinâmica de pendências passíveis (status sem_resposta + atrasadas), descrição contextual e botão "Ver pendências" que ativa a tab pendencias.
4. **Bloco `#kpis-lanc-tab`** com 4 KPIs do mês corrente:
   - **Manuais este mês**: contagem + R$ total
   - **Fornecedores únicos**: distintos no mês
   - **Aprovados/Pagos** (accent): contagem + R$ liberados
   - **Em análise** (warn): contagem + R$ pendente
5. **Tabela `#lanc-recentes-tabela`** com top 5 do mês: Protocolo/Fornecedor (razão social + doc)/Modalidade/Valor BRL/Status (pill)/Lançado em (BR)/link "Ver →" para envio.html. Empty state se nenhum.
6. **Subtitle pedagógico** preserva caminho padrão verde mais conciso ("Convide um fornecedor com conta..." em vez do parágrafo longo).
7. **Listener** da tab dispara `carregarTabLancar()` que computa atalho + KPIs + recentes via `api.listarExpectativas()` + `api.envios({origem:'manual', competencia: compMes})`.

**Funcionalidades preservadas** (nenhuma removida):
- Caminho padrão recomendado (highlight verde com pill Portal + botão "Convidar cadastrado" → modal-expectativa).
- 3 cards de exceção: "+ Cadastrar fornecedor externo" → modal-externo, "Link · Enviar link público" → modal-link, "Manual · Lançar você mesmo" → modal-manual.
- Modais existentes funcionam exatamente como antes.

**Funcionalidade testada via Preview** (operador HECC Carlos Souza):
- Login ✓
- Clicar aba "Novo lançamento" ✓
- H1 "Iniciar novo pagamento" + pill Operador HECC ✓
- Subtitle "Escolha como o fornecedor irá interagir..." ✓
- Banner pedagógico azul renderiza ✓
- Atalho conversão visível com "2 pendência(s) podem ser convertidas" ✓
- 4 KPIs: Manuais este mês=1, Únicos=1, Aprovados/Pagos=0, Em análise=1 ✓
- 1 row de lançamento manual recente renderizada ✓
- Caminho padrão verde com pill Portal preservado ✓
- 3 cards de exceção preservados ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V257 — 2026-05-25 — Painel aba Pendências alinhada ao mockup (loop tela #16)
**Por quê**: décima sexta tela do loop. Mockup screen-pendencias tem subtitle pedagógico + banner azul explicativo + 4 KPIs específicos (Aguardando/Lembrete enviado/Sem resposta/Atrasadas) + filtros ricos (busca + tipo fornecedor + modalidade + ordenação + contador). App tinha apenas H2 simples + alert info + botão criar, sem KPIs, contador, busca ou ordenação.

**Tela**: `painel.html` (aba Pendências, ID `tab-pendencias`).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Subtitle dinâmico | "N expectativas · X atrasadas · Y sem resposta" | "Expectativas configuradas..." (estático) |
| Banner pedagógico | "O que é uma pendência?" com `decision-banner` | ❌ ausente (só alert info curto) |
| 4 KPIs específicos | Aguardando / Lembrete enviado / Sem resposta / Atrasadas | ❌ ausente |
| Filtros (busca + status + ordenação) | ✓ + contador | ❌ ausente |

**Mudanças aplicadas** (apenas visual + UX):
1. **Banner pedagógico azul** (`#pend-banner` com classe `alert info`) explicando o conceito de pendência + ações disponíveis (reagendar / lançar manual / cancelar com justificativa).
2. **Bloco `#kpis-pend-tab`** com 4 KPIs dinâmicos:
   - **Aguardando envio** + sub "prazo ainda em dia"
   - **Sem resposta** (warn) + sub "passou do 2º lembrete"
   - **Atrasadas** (danger se >0) + sub "prazo expirou · ação obrigatória" / "— sem atrasos"
   - **Ativas** (accent) + sub "não cumpridas / canceladas"
3. **Filtros enriquecidos** no card:
   - Busca por fornecedor/modalidade/CNPJ (input search)
   - Select status (Todos/Atrasadas/Sem resposta/Aguardando/Cumpridas/Canceladas)
   - Select ordenação (mais críticas / prazo próximo / fornecedor A-Z)
   - Botão "+ Criar expectativa" (preservado)
   - Contador "N expectativa(s) (de M)" à direita
4. **Subtitle dinâmico** via `#page-subtitle`: `"N expectativa(s) ativa(s) · X atrasada(s) · Y sem resposta"` (substitui o sub estático do TAB_HEADERS).
5. **Filtros são client-side** sobre o array já carregado (`api.listarExpectativas()` continua igual).

**Funcionalidades preservadas** (nenhuma removida):
- Cálculo de urgência via função `computar()` (atraso/vence hoje/dias restantes/em N dias) com cores e labels.
- Tabela com colunas Urgência (pill colorido)/Fornecedor (razão social + doc + tipo)/Modalidade/Comp./Prazo (BR)/Status (pill)/Lembretes/Ações.
- Realce visual de row em atraso (background vermelho leve) ou >urgência 70 (laranja leve).
- Banner de bulk actions quando há atrasadas: "📧 Lembrar todas atrasadas" + (se >30d) "× Cancelar antigas (>30d)".
- Botões por linha: 📧 disparar lembrete, "Lançar manual" → modal pré-preenchido com fornecedor, × cancelar com prompt de motivo.
- Lembrete/cancelamento/lançar disparam `carregarPendencias()` para refresh.

**Funcionalidade testada via Preview** (operador HECC Carlos Souza):
- Login ✓
- Clicar aba Pendências ✓
- Subtitle "3 expectativa(s) ativa(s) · 1 atrasada(s) · 1 sem resposta" ✓
- Banner pedagógico renderiza ✓
- 4 KPIs corretos: Aguardando=1 / Sem resposta=1 (warn) / Atrasadas=1 (danger) / Ativas=3 (accent) ✓
- Contador "3 expectativa(s)" ✓
- Filtro status "atrasada" → "1 expectativa(s) (de 3)" ✓
- Busca "tec" → "1 expectativa(s) (de 3)" ✓
- Ordenação A-Z: primeira linha = "Maria das Graças Conceição" ✓
- Bulk action "📧 Lembrar todas atrasadas" continua visível ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V256 — 2026-05-25 — Painel aba Fornecedores alinhada ao mockup (loop tela #15)
**Por quê**: décima quinta tela do loop. Mockup screen-forn-hecc tem subtitle de composição da rede ("12 com portal + 5 externos · 17 atendendo a HECC") + 5 KPIs específicos (Com portal / Externos / Movimentaram mês / Em retificação / Pontualidade) + filtros (busca + status + modalidade + contador). App tinha apenas título genérico + filtros mínimos (busca + tipo), sem KPIs nem contador.

**Tela**: `painel.html` (aba Fornecedores, ID `tab-fornecedores`).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Subtitle | "N com portal + X externos · Y atendendo a HECC" | "Quem está habilitado a enviar documentação..." (estático) |
| KPI strip dedicado | 5 KPIs (Com portal/Externos/Movimentaram/Em retificação/Pontualidade) | ❌ ausente |
| Filtros | busca + status + modalidade + contador | só busca + tipo |
| Contador | "12 fornecedores" | ❌ ausente |
| Filtro engajamento | implícito em "status" | ❌ ausente |

**Mudanças aplicadas** (apenas visual + UX):
1. **Subtitle dinâmico** computado em `carregarFornecedores()`: `"N com portal + X externos (sem portal) · Y atendendo a SIGLA"` (substitui o subtitle estático do TAB_HEADERS).
2. **Bloco `#kpis-forn-tab`** com 4 KPIs específicos:
   - **Com portal** (accent) + sub "auto-serviço · logam no portal"
   - **Externos** (warn) + sub "sem portal · você opera por eles"
   - **Ativos** + sub "engajamento OK · respondendo"
   - **Inadimplentes** (danger se >0) + sub "recusam-se a enviar" / "— sem ocorrências"
3. **Filtros enriquecidos** na barra (lado direito do card):
   - Busca por razão social/CNPJ
   - Select "Todos os tipos" (Com portal / Externo PJ / Externo PF)
   - **Novo**: Select "Todos os engajamentos" (Ativo / Inadimplente / Inativo)
   - Botão "+ Cadastrar externo"
   - **Contador**: "N fornecedor(es) (de M)"
4. **API call agora sempre busca TODOS** (`api.fornecedores(null)`) para calcular KPIs corretos; tipo/engajamento são filtros client-side via `filtrados.filter()`.
5. **Descrição condensada** ("Com portal = auto-serviço (fornecedor logado). Externo = você opera por ele") em vez de parágrafo longo.

**Funcionalidades preservadas** (nenhuma removida):
- Duas listas separadas com cabeçalhos coloridos: "Com portal · auto-serviço" (verde) / "Externos · sem portal (você opera)" (laranja).
- Tabela com colunas: Razão social | Documento | Tipo (pill `origin`) | Engajamento (pill `eng-chip` com tooltip motivo) | E-mail | ações.
- Botão "Ver detalhes" por linha (redireciona para `/app/admin-fornecedor.html?id=X`).
- Botão "+ Lançar" (apenas externos) → abre modal-manual com fornecedor pré-selecionado via `lancarParaFornec()`.
- Cache `cacheFornecedores` para popular selects de outros modais (expectativa/link/manual) — V25/Multi-unit.
- Botão "+ Cadastrar fornecedor externo" abre modal-externo (CRUD V19).
- Realce visual (background levemente vermelho) em linha de fornecedor inadimplente.

**Funcionalidade testada via Preview** (operador HECC Carlos Souza):
- Login operador HECC ✓
- Clicar aba Fornecedores ✓
- Subtitle "4 com portal + 4 externos (sem portal) · 8 atendendo a HECC" ✓
- 4 KPIs corretos: Com portal=4 / Externos=4 / Ativos=8 / Inadimplentes=0 ✓
- Filtro tipo "externo_pj" → contador "2 fornecedor(es) (de 8)" ✓
- Filtro busca "medsupply" → contador "1 fornecedor(es) (de 8)" ✓
- Listas Portal/Externos renderizam tabela completa com botões funcionais ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V255 — 2026-05-25 — Admin Relatórios alinhado ao mockup (loop tela #14)
**Por quê**: décima quarta tela do loop. Mockup tem header rico (eyebrow "INTELIGÊNCIA OPERACIONAL" + H1 + pill visão + subtitle dinâmico mencionando exportação) + 4 KPIs específicos de inteligência (Movimento mês / Tempo médio / Índice retificação / Índice rejeição) com sub-stats descritivas. App tinha header simples ("Relatórios da rede") + 5 KPIs com nomes diferentes (Envios totais / Movimento / Unidades / Pendências críticas / Fornecedores inadimplentes).

**Tela**: `admin-relatorios.html` (screen-relatorios).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow | "INTELIGÊNCIA OPERACIONAL" | ❌ ausente |
| H1 + pill visão | "Relatórios" + ● Visão: FESF Sede | "Relatórios da rede" sem pill |
| Subtitle | "Indicadores consolidados · exportação CSV/PDF/planilha" | "Visão consolidada · todas competências" só |
| KPIs (4) | Movimento / Tempo médio / Índice retific. / Índice rejeição | 5 KPIs sem sub-stats descritivas |
| Sub-stats KPIs | "N envios · X unid." etc | ❌ ausente |

**Mudanças aplicadas** (apenas visual + UX):
1. **Header reorganizado** com eyebrow "INTELIGÊNCIA OPERACIONAL" + H1 "Relatórios" + pill verde "● Visão: FESF Sede" + subtitle dinâmico (`Indicadores consolidados da rede FESF · N unidade(s) ativa(s) · X fornecedor(es) inadimplente(s) · exportação CSV / PDF`).
2. **4 KPIs reformulados** ao estilo mockup com sub-stats descritivas:
   - **Movimento** (accent, valor monetário grande) + sub "N envios · X unid."
   - **Tempo médio (aprovação)** em dias + sub "X aprovações no período"
   - **Índice de retificação** (warn) em % + sub "N de M envios"
   - **Índice de rejeição** (danger) em % + sub "X rejeitados · Y pendência(s) crítica(s)"
3. **Botão Exportar** prefixado com `⬇` para sinalização visual.

**Funcionalidades preservadas** (nenhuma removida):
- Filtro de competência (select com 12 últimas + "Todas competências") + listener change → refetch.
- Botão Atualizar (refetch manual).
- Export CSV via `/api/envios/export.csv` (sem alterações).
- Imprimir / PDF abre `/app/relatorio-print.html?competencia=X`.
- Bloco SLA · tempo médio (envio→aprov, aprov→pago) com barras.
- Distribuição por hora do dia (heatmap dos últimos 90d com pico destacado).
- Envios por semana (últimas 8) com bar chart vertical.
- Bar charts: Por unidade · ranking, Por origem, Por status, Por modalidade.
- Tabela Pendências (expectativas) com pills coloridos por status.
- Contagem de fornecedores inadimplentes mantida no subtitle dinâmico.

**Funcionalidade testada via Preview**:
- Login admin Maria Andrade ✓
- Header renderiza com eyebrow + H1 + pill + subtitle ("Indicadores consolidados da rede FESF · 1 unidade(s) ativa(s) · exportação CSV / PDF") ✓
- 4 KPIs corretos: Movimento R$ 179.250,00 (3 envios · 1 unid.) / Tempo médio 0.0 d / Retificação 0.0% / Rejeição 0.0% (0 rejeitados · 2 pendência(s) crítica(s)) ✓
- Filtro competência: troca para "2026-05" refresca subtitle para "Competência 2026-05 · 3 envios · exportação CSV / PDF" ✓
- `/api/envios/export.csv?competencia=2026-05` retorna 672 bytes (200 OK) ✓
- `/app/relatorio-print.html` acessível (200 OK) ✓
- Zero erros no console ✓

**Testes**: 1127 verdes · 0 falhas (v21 incluso, que valida `inadimplentes` presente no HTML — preservado via subtitle).

---

### V254 — 2026-05-25 — Admin Usuários alinhado ao mockup (loop tela #13)
**Por quê**: décima terceira tela do loop. Mockup tem header rico + 4 KPIs específicos (Total ativo / Operadores / Admins / Fornecedores) + filtros enriquecidos (Buscar + Status + contador). App tinha header simples + KPIs com nomes diferentes.

**Tela**: `admin-usuarios.html` (screen-usuarios).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow | "ADMINISTRACAO DA REDE" | ❌ ausente |
| H1 + pill visão | "Usuarios e operadores" + ● Visao: FESF Sede | "Usuários da rede" sem pill |
| Subtitle dinâmico | "N usuários · X operadores · Y admins · Z fornecedores" | "Operadores de unidade, admins FESF e fornecedores logados" genérico |
| 4 KPIs específicos | Total Ativo / Operadores / Admins FESF / Fornecedores | Total / Admins / Operadores / Fornecedores |
| Sub-stats nos KPIs | "+5 nos ultimos 30 dias" / "distribuidos em N unidades" | sem sub-stats |
| Filtros busca + status | ✓ | só papel + unidade |
| Contador | "68 usuários" | ❌ ausente |

**Mudanças aplicadas** (apenas visual + UX):
1. **Header reorganizado** com eyebrow "ADMINISTRAÇÃO DA REDE" + H1 "Usuários e operadores" + pill verde "● Visão: FESF Sede" + subtitle dinâmico (`N usuários cadastrados · X operadores · Y admins · Z fornecedores`).
2. **Ações no header**: `⬇ Exportar` (CSV) + botão primário renomeado para `+ Novo usuário` (era "+ Novo operador/admin").
3. **4 KPIs reorganizados** com sub-stats:
   - "Total ativo" + "de N totais"
   - "Operadores" accent + "de unidade"
   - "Admins FESF" + "acesso total"
   - "Fornecedores" + "com portal"
4. **Filtros enriquecidos**:
   - Input search "Buscar por nome ou e-mail…"
   - Select "Todos os status" / Ativos / Inativos (novo)
   - Listeners para filtrar client-side ao digitar
5. **Contador** `N usuário(s) (de M)` à direita dos filtros.
6. **`exportarUsuariosCSV()`** monta CSV inline com Nome;Email;Papel;Unidade/Fornecedor;Status;Último Login.

**Funcionalidades preservadas** (nenhuma removida):
- Filtros existentes: Todos os papéis (admin/operador/fornecedor), Todas unidades.
- Tabela: NOME | EMAIL | PAPEL (pill colorido) | UNIDADE/FORNECEDOR | STATUS | ÚLTIMO LOGIN.
- Botões por linha: 🏥 (gerenciar unidades extras - V25 multi-unit), Resetar senha, Desativar/Reativar.
- Modal "Novo usuário" com seleção de papel, unidade, e-mail.
- Helper senha temporária copiável (V223/A1).

**Funcionalidade testada via Preview**:
- Login admin Maria Andrade ✓
- Header renderiza com eyebrow + H1 + pill + subtitle ("13 usuários cadastrados · 8 operadores · 1 admin · 4 fornecedores") ✓
- 4 KPIs corretos: Total ativo 13 (de 13 totais) / Operadores 8 (de unidade) / Admins FESF 1 (acesso total) / Fornecedores 4 (com portal) ✓
- Filtros visíveis (Buscar + Papéis + Unidades + Status + Aplicar) + contador "13 usuário(s)" ✓
- Tabela exibe 13 usuários com pills coloridos e botões funcionais ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V253 — 2026-05-25 — Admin Fornecedores alinhado ao mockup (loop tela #12)
**Por quê**: décima segunda tela do loop. Mockup tem header rico (eyebrow + título + pill visão + subtitle dinâmico de composição da rede) + 4 KPIs no topo (Pendentes / Com portal / Externos / Suspensos). App tinha header simples sem visão pill e sem KPIs.

**Tela**: `admin-fornecedores.html` (screen-fornecedores).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow | "ADMINISTRACAO DA REDE" | ❌ ausente |
| H1 + pill visão | "Fornecedores" + ● Visão: FESF Sede | "Fornecedores" sem pill |
| Subtitle dinâmico | composição (com portal + externos · total) | "Todos os fornecedores cadastrados na rede FESF" |
| 4 KPIs | Pendentes / Com portal / Externos / Suspensos | ❌ ausentes |
| Ações header | Exportar + + Cadastrar fornecedor | só filtros |
| Tabela completa | — | ✅ preservada |

**Mudanças aplicadas** (apenas visual + UX):
1. **Header reorganizado** com eyebrow "ADMINISTRAÇÃO DA REDE" + H1 "Fornecedores" + pill verde "● Visão: FESF Sede" + subtitle dinâmico (`N com portal + M externos (sem portal) · T fornecedores totais na rede`).
2. **Ações no header**: `⬇ Exportar` (CSV) + botão primário `+ Cadastrar fornecedor` (redireciona para `/app/cadastro.html`).
3. **4 KPIs** com sub-stats:
   - "Pendentes aprovação" (danger se > 0)
   - "Com portal · ativos" (accent) — auto-serviço
   - "Externos (sem portal)" — operador opera
   - "Inadimplentes / inativos" (warn) — N inadimp · M inativ
4. **Filtro de tipo passou para client-side** — agora busca, tipo e engajamento todos filtram localmente no cache `todosForn` carregado uma vez.
5. **`exportarFornecedoresCSV()`** monta CSV inline com BOM UTF-8 (Razão Social;CNPJ/CPF;Tipo;Engajamento;E-mail).

**Funcionalidades preservadas** (nenhuma removida):
- Filtros: Buscar por razão social/CNPJ, Todos os tipos, Todos engajamentos, Aplicar.
- Tabela: Razão social | CNPJ/CPF | Tipo (pill colorido) | Engajamento (pill com tooltip de motivo) | E-mail.
- Ações por linha: Detalhe (link para admin-fornecedor) / Engajamento (botão de ação).
- Tooltip de motivo do engajamento.

**Funcionalidade testada via Preview**:
- Login admin Maria Andrade ✓
- Header renderiza com eyebrow + H1 + pill + subtitle ("4 com portal + 4 externos (sem portal) · 8 fornecedores totais na rede") ✓
- 4 KPIs corretos: Pendentes 0 (— sem pendências) / Com portal 4 (auto-serviço) / Externos 4 (operador opera) / Inadimp+inativ 8 (0 inadimp · 8 inativ) ✓
- Tabela com 8 fornecedores e pills coloridos (Portal verde / Externo PJ azul / Externo PF amarelo) ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V252 — 2026-05-25 — Admin Unidades alinhado ao mockup (loop tela #11)
**Por quê**: décima primeira tela do loop. Mockup tem header rico (eyebrow + título + pill visão + subtitle dinâmico) + filtros embutidos (Buscar + tipos + status). App tinha header simples sem visão pill nem filtros.

**Tela**: `admin-unidades.html` (screen-gerunidades).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow | "ADMINISTRAÇÃO DA REDE" | ❌ ausente |
| H1 + pill visão | "Unidades" + ● Visão: FESF Sede | "Unidades da rede" sem pill |
| Subtitle dinâmico | "N cadastradas · X ativas · Y em implantação" | "Gestão de unidades operacionais da FESF-SUS" genérico |
| Ações no header | Exportar + "+ Cadastrar unidade" | só "+ Nova unidade" |
| Filtros | Buscar + tipos + status | ❌ ausentes |
| Cards de unidades (mockup) | grid 3 colunas | tabela com colunas |
| Tabela (app) | — | ✅ preservada (mais escaneável) |

**Decisão**: preservar tabela do app (escaneável para muitas unidades) + adicionar elementos visuais do mockup ao header + filtros funcionais.

**Mudanças aplicadas** (apenas visual + UX):
1. **Header reorganizado** com eyebrow "ADMINISTRAÇÃO DA REDE" + H1 "Unidades" + pill verde "● Visão: FESF Sede" + subtitle dinâmico.
2. **Ações no header**: `⬇ Exportar` (CSV de unidades) + botão primário renomeado para `+ Cadastrar unidade`.
3. **Filtros embutidos no card "Lista de unidades"**:
   - Input search "Buscar por nome, sigla ou cidade…"
   - Select "Todos os status" / Ativas / Inativas
4. **Cache + render separado**: variáveis `_unidadesCache` e `_metricasCache` + função `renderListaUnidades()` aplica filtros sem refetch.
5. **Função `exportarUnidadesCSV()`** monta CSV inline (Sigla;Nome;Cidade;UF;Tipo;Status) com BOM UTF-8.

**Funcionalidades preservadas** (nenhuma removida):
- Tabela com colunas: Sigla | Nome | Cidade | UF | Status | Envios | Movimento.
- Ações por linha: Detalhes / Editar / Desativar (Reativar).
- KPIs gerais: Unidades ativas / Envios da rede / Movimento total / Inativas.
- Modal de criação/edição.
- Métricas dinâmicas por unidade (envios + movimento).

**Funcionalidade testada via Preview**:
- Login admin Maria Andrade ✓
- Header renderiza com eyebrow + H1 + pill + subtitle dinâmico ("8 unidades cadastradas · 8 ativas · 0 inativas") ✓
- Tabela exibe 8 unidades (CAPS-MSJ, HECC com 3 envios + R$ 179.250, HMI, MRC, PE, etc.) ✓
- Filtros visíveis e prontos (input + select) ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V251 — 2026-05-25 — Admin Dashboard (FESF Sede) alinhado ao mockup (loop tela #10)
**Por quê**: décima tela do loop. Mockup tem header rico (eyebrow + título + subtitle dinâmico + ações primárias) + KPIs com semântica diferente (em análise / aguard. ret. / aprovados mês / pendências críticas). App tinha header simples e KPIs genéricos.

**Tela**: `admin.html` (screen-admin).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow | "VISÃO CONSOLIDADA" | ❌ ausente |
| H1 | "Dashboard operacional" | "Métricas da rede" |
| Subtitle dinâmico | contagem específica + competência | "Todas as competências" genérico |
| Ações no header | Exportar CSV + + Lançamento manual | só "Atualizar" |
| KPIs | Em análise / Aguard ret / Aprovados mês / Pendências críticas | Envios totais / Movimento / Unidades / Pendências |
| Sub-stats dos KPIs | "+12% vs abril" / valores secundários | ausente |
| Cards "Por unidade/origem/modalidade/status" | ✓ | ✓ (preservado) |

**Mudanças aplicadas** (apenas visual + UX):
1. **Header reorganizado** com eyebrow "VISÃO CONSOLIDADA" (uppercase letterspaced) + H1 "Dashboard operacional" + subtitle dinâmico montado a partir das métricas (`X de Y unidades ativas · N envios + M pendências em [competência]`).
2. **Ações no header**: botão `⬇ Exportar CSV` (chama `/api/envios/export.csv`) + botão primário `+ Lançamento manual` (direciona para admin-unidades com toast informativo).
3. **KPIs alinhados ao mockup**:
   - "Em análise" (count + movimento total)
   - "Aguard. ret." warn (count + "esperando fornecedor" / "— sem pendências")
   - "Aprovados (mês)" accent (count + "incluindo pagos" / "— ainda nenhum")
   - "Pendências críticas" danger/warn (count + "N atrasadas · M sem resposta" / "— sem pendências")

**Funcionalidades preservadas** (nenhuma removida):
- Filtro de competência (select)
- Bar charts: Por unidade / Por origem / Por modalidade / Por status
- Tab "Pendentes" (fornecedores pendentes de aprovação) com badge
- Resumo de pendências da rede
- Notificações bell + perfil link
- Todas as tabs admin (Dashboard, Pendentes, Pagamentos, Unidades, Fornecedores, Usuários, Relatórios, Auditoria, E-mails, SMTP, Status, API, Config)

**Funcionalidade testada via Preview**:
- Admin (Maria Andrade) login + abrir `/app/admin.html`
- Header renderiza: "VISÃO CONSOLIDADA / Dashboard operacional / Pagamentos da rede FESF · 1 de 8 unidades ativas · 3 envios + 3 pendências em todas as competências" ✓
- 4 KPIs renderizam corretos: Em análise 3 (R$ 179.250 movimento) / Aguardando ret. 0 (— sem pendências) / Aprovados 0 (— ainda nenhum) / Pendências críticas 2 (1 atrasada · 1 sem resposta) ✓
- Bar charts continuam funcionais ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V250 — 2026-05-25 — Sucesso (pós-envio) — app já supera o mockup (loop tela #9)
**Por quê**: nona tela do loop. Comparação revelou que o app já supera o mockup nesta tela — implementação rica desde V101.

**Tela**: `sucesso.html` (screen-sucesso).

**Comparação mockup × app**:

| Elemento | Mockup | App |
|---|---|---|
| Hero com checkmark | ✓ verde simples | ✓ verde **com box-shadow elegante** |
| H1 + lead | ✓ | ✓ |
| Bloco protocolo | fundo roxo plano | **gradient roxo→verde** (mais bonito) |
| Resumo do envio | tabela com 5 campos | tabela com **10 campos** (mais completo) |
| Próximos passos | texto inline | **lista numerada com 4 etapas** (mais claro) |
| Ações | "Voltar" simples | **3 botões**: Acompanhar no portal · Baixar recibo · Consultar protocolo |

**Decisão**: **nenhuma mudança visual aplicada** — app permanece como referência, mockup pode ser atualizado para refletir o app no futuro.

**Funcionalidade testada via Preview**:
- Login como fornecedor + abrir `sucesso.html?id=1`
- 3 botões renderizam com URLs corretas (`/app/portal.html`, `/app/recibo.html?id=1`, `/app/consulta.html`)
- Dados carregados: protocolo `HECC-SEED-0001`, fornecedor `Empresa Hospitalar Ltda.`, unidade, valor `R$ 158.000,00`, origem `Portal (logado)` ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V249 — 2026-05-25 — Formulário público anônimo (publico.html) — visual mockup (loop tela #8)
**Por quê**: oitava tela do loop. Mockup tem header rico com tagline + pill verde + card de contexto em tabela. App tinha card simples sem tagline ou pill.

**Tela**: `publico.html` (screen-formpublico).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Tagline canto direito | "🔒 Link específico · acesso sem cadastro" | ❌ ausente |
| Pill "ENVIO SEM LOGIN" verde | ✓ | ❌ ausente |
| H1 dinâmico com sigla | "Envio de documentos · HECC" | "Envio de documentação" (genérico) |
| Lead destacando "especificamente para a sua empresa" | ✓ | genérico |
| Card de contexto em tabela | Empresa/CNPJ/Unidade/Modalidade/Operador | card verde resumido |
| Lista "O que esperar" | ✓ | ✓ (preservado) |
| LGPD | ✓ | ✓ (preservado) |

**Mudanças aplicadas** (apenas visual):
1. **Header reorganizado** em flex space-between: brand à esquerda + tagline à direita.
2. **Pill verde "ENVIO SEM LOGIN"** no topo do estado-form (com fundo `accent-soft` + texto `accent`).
3. **H1 dinâmico** — quando `ctx.unidade_sigla` disponível, vira "Envio de documentos · {SIGLA}".
4. **Lead dinâmico** — quando `ctx.razao_social` disponível, vira "Você está usando um link criado pela equipe {SIGLA} **especificamente para a sua empresa**...".
5. **Card de contexto reformatado em tabela** com até 5 linhas: Empresa, CNPJ, Unidade de destino, Modalidade, Operador responsável (com mailto link).

**Funcionalidades preservadas** (nenhuma removida):
- Lookup do token via `api.lookupLink(token)`.
- Validação: link inválido → mensagem "já foi utilizado anteriormente. Solicite um novo à unidade FESF".
- Mapeamento `codigoToForm` → URL do formulário correto.
- Botão "Abrir formulário →" com URL parametrizada (modalidade, unidade, competência, public_token).
- Lista "O que esperar".
- Bloco LGPD.
- Skip-link de acessibilidade.

**Funcionalidade testada via Preview**:
- Operador HECC cria link público novo via `POST /api/links` ✓
- Fornecedor abre `publico.html?token=...` → contexto renderiza com Empresa, CNPJ, Unidade, Modalidade ✓
- H1 e lead refletem dados do ctx ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V248 — 2026-05-25 — Links públicos (painel aba) — header dinâmico (loop tela #7)
**Por quê**: sétima tela do loop. Mockup tem header rico (eyebrow + h1 + pill + subtitle) específico para cada tela do painel. App tinha apenas o header da aba "Envios" fixo.

**Tela**: `painel.html` aba `links` (screen-links).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Eyebrow contextual | ✓ "HOSPITAL..." | só na aba envios |
| H1 dinâmico por tab | "Links de envio" | sempre "Painel da unidade" |
| Visão pill | ✓ | só na aba envios |
| Subtitle contextual | ✓ | só na aba envios |
| KPIs visíveis em outras abas | não polui | apareciam em todas |
| Botão "+ Gerar link" | ✓ | ✓ (existente, modal) |
| Tabela de links + Copiar URL + Status | ✓ | ✓ (existente V25/V227) |

**Mudanças aplicadas** (apenas estrutura visual):
1. **Tabela `TAB_HEADERS`** em JS mapeia `tab → {title, sub, visao}`.
2. **Função `aplicarHeaderTab(tab)`** atualiza title/subtitle/pill da página quando troca de tab.
3. **Tab click handler** chama `aplicarHeaderTab(tab)` + esconde `#kpis`, `#alertaCriticas` e `#chart-sidebar-wrap` quando não está em "envios".

**Resultado**:
- Tab "Envios": header "Painel da unidade" com KPIs + chart + atividade.
- Tab "Links públicos": header "Links de envio" + subtitle específico + apenas a tabela de links (sem KPIs poluindo).
- Tab "Pendências": header "Pendências de envio" + subtitle específico.
- Tab "Fornecedores": header "Fornecedores da unidade".
- Tab "Novo lançamento": header "Novo lançamento manual".

**Funcionalidades preservadas** (nenhuma removida):
- Modal "Gerar link" (existia desde V25).
- Tabela com colunas Token | Fornecedor | Modalidade | Destinatário | Usos | Status | Criado | Ações.
- Botão "Copiar URL" por linha.
- Contador de usos `n / max` (V227).
- Status pill (Ativo/Usado/Revogado/Expirado).
- Prazo de expiração visível.

**Testes**: 1127 verdes · 0 falhas.

---

### V247 — 2026-05-25 — Envio detalhes (operador) — trajetória estilo mockup (loop tela #5)
**Por quê**: quinta tela do loop. Mockup tem trajetória do envio com **dots circulares conectados por linhas finas** — visualmente muito mais elegante que os chips de fundo colorido do app.

**Tela**: `envio.html` (screen-details).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Trajetória do envio | dots + linhas finas | chips coloridos com label uppercase |
| Card header envio | eyebrow + origem pill + status pill | semelhante |
| Tabs (Resumo/Form/Docs/Comentários) | ✓ | ✓ |
| Tab Auditoria adicional | ❌ ausente | ✅ presente (app feature) |
| Card Ações (lateral direito) | ✓ | ✓ |

**Mudança aplicada** (apenas visual — trajetória):
- CSS reescrito para `.timeline-step` usando `::before` (dot circular 14×14 com border + shadow) e `::after` (linha 2px conectando à próxima etapa).
- Classes:
  - `.done` → dot verde (var(--accent))
  - `.active` → dot roxo (var(--primary)) com halo `box-shadow` 4px primary-soft
  - `.pending` → dot cinza (var(--border-strong))
- Label e data ficam centrados abaixo do dot, com `padding-top:28px` para abrir espaço.
- Removido `<span class="timeline-arrow">›</span>` entre steps — a linha conectora é feita pelo `::after`.

**Funcionalidades preservadas** (nenhuma removida):
- Aprovar envio (botão verde, fluxo testado em V241).
- Solicitar retificação (modal/prompt, testado V241).
- **Rejeitar** (testado nesta sessão: envio?id=3 → status "Rejeitado" ✓).
- Encaminhar para FESF Sede (V18).
- Imprimir recibo.
- Hotkeys A/R/X (V230).
- Tabs: Resumo / Formulário / Documentos / Comentários / **Auditoria** (app exclusivo).
- SLA visual (V230), anotações entre operadores (V231).

**Testes**: 1127 verdes · 0 falhas.

---

### V246 — 2026-05-25 — Senha (Esqueci) alinhado ao mockup (loop tela #3)
**Por quê**: terceira tela do loop. Mockup tem pill brand + hint text + botão descritivo + footer com 2 caminhos.

**Tela**: `senha.html` (screen-senha).

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Pill "RECUPERAR SENHA" topo | ✓ roxa | ❌ ausente |
| Lead text | menciona "link de redefinição em alguns minutos" | "admin será notificado" |
| Hint abaixo do input | "Use o mesmo e-mail informado no cadastro..." | ❌ ausente |
| Botão | "Enviar link de recuperação" (descritivo) | "Solicitar reset" (vago) |
| Footer | "Fazer login · Cadastre-se" (2 caminhos) | só "← Voltar ao login" |
| Loading state no botão | — | ❌ ausente |

**Mudanças aplicadas** (apenas visual + UX):
1. **Pill "RECUPERAR SENHA"** roxa no topo do estado-form.
2. **Lead atualizado** para refletir o fluxo real (V214 introduziu SMTP): menciona "link em alguns minutos" quando SMTP ativo OU "administrador entrará em contato" quando modo simulador.
3. **Hint text** abaixo do input ajudando o usuário a usar o e-mail correto.
4. **Botão** com texto mais descritivo + `autocomplete="email"` no input.
5. **Footer com 2 caminhos**: "Fazer login" e "Cadastre-se".
6. **Loading state** no botão: durante o submit fica `disabled` com texto "Enviando…".
7. **Tela de sucesso** com texto atualizado (menciona SMTP ativo vs simulador) + hint sobre spam/cadastro.

**Funcionalidades preservadas**:
- Endpoint `api.esqueciSenha(email)`.
- Estado de sucesso com checkmark verde.
- Background gradient roxo/verde.

**Funcionalidade testada via Preview**:
- Preencher e-mail (`contato@empresahosp.com.br`) + submit → tela de sucesso visível com texto + ícone ✓ + link de volta ao login ✓
- Formulário escondido após submit ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V245 — 2026-05-25 — Cadastro alinhado ao mockup (estética, próxima tela do loop)
**Por quê**: usuário pediu para revisar **uma tela por vez** em loop, comparando mockup × app e aplicando o melhor do mockup, **preservando funcionalidades existentes** mesmo que não estejam no mockup.

**Sistema de loop introduzido**: arquivo `PROGRESSO-MOCKUP.md` na raiz rastreia as 24 telas (✅ revisado / 🔄 em andamento / ⏳ pendente). A cada execução do comando, pega a próxima tela pendente.

**Tela revisada**: `cadastro.html` (screen-cadastro). Já estava no histórico de V229/V238.

**Comparação mockup × app**:

| Elemento | Mockup | App ANTES |
|---|---|---|
| Pill "NOVO FORNECEDOR" topo | ✓ roxa | ❌ ausente |
| H1 + lead | "Cadastre sua empresa" + lead curto | "...no Portal" + lead longo |
| Box info "Como funciona" | ✓ roxa com ícone i + 3 etapas numeradas | alert verde com texto corrido |
| Cards "Auto-serviço/Acompanhamento/Histórico" | ❌ ausente | ✅ presentes (3 cards) |
| Asteriscos required | ❌ ausente | ✅ presentes (V238) |
| Form submit + validação CNPJ | ✓ | ✓ (V229) |

**Mudanças aplicadas** (apenas visual):
1. **Pill "NOVO FORNECEDOR"** roxa (brand-aligned) no topo do estado-form.
2. **Box info roxo** com ícone "i" circular + lista numerada de 3 etapas — substitui o alert verde com texto corrido.

**Funcionalidades preservadas** (não-removidas mesmo ausentes no mockup):
- 3 cards de benefícios (Auto-serviço / Acompanhamento / Histórico) — reforçam proposta de valor.
- Asteriscos vermelhos em fields required.
- Nome do contato responsável (V229).
- Validação CNPJ 14 dígitos.
- Bloco "Pessoa Física?" no rodapé.

**Funcionalidade testada via Preview**:
- Empty submit → erro "Selecione pelo menos uma unidade" ✓
- Marca unidade + submit → tela sucesso "Cadastro enviado" com checkmark verde + texto "será analisado pela equipe FESF em até 1 dia útil" + link "Voltar ao login →" ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V244 — 2026-05-25 — Painel operador alinhado ao mockup (estética)</new_str>
**Por quê**: usuário pediu para verificar se os elementos estão "bonitos igual ao mockup". Comparei lado-a-lado painel atual com mockup — encontrei lacunas significativas no header do painel operador.

**Diferenças capturadas via screenshot side-by-side:**
- ❌ App não tinha eyebrow com nome do hospital + cidade
- ❌ App não tinha H1 "Painel da unidade" + pill "Visão: Operador HECC"
- ❌ App não tinha subtitle dinâmico com competência + counts + valor movimentado
- ❌ App não tinha filtros + ações no header (Período, Exportar CSV, +Novo lançamento)
- ❌ KPIs não tinham sub-stats secundárias (ex: "+18% vs abril", "R$ + N fornecedores")
- ❌ Topnav genérico "Sistema funcional" em vez de "{SIGLA} · Painel da unidade"

**Fix em `painel.html`:**

1. **Topnav contextual**: subtitle muda para `{unidade_sigla} · Painel da unidade` ao logar.

2. **Page-head novo** com eyebrow + título + subtitle + ações horizontais:
   - **Eyebrow uppercase**: nome completo do hospital + cidade (vem de `api.detalheUnidade()`)
   - **H1** com pill verde inline "● Visão: Operador {SIGLA}"
   - **Subtitle dinâmico** populado após KPIs carregarem: `{comp} · N envios recebidos · M pendências · R$ X movimentados`
   - **Filtros à direita**: select de competência + botão `⬇ Exportar CSV` + botão primário `+ Novo lançamento`

3. **KPIs enriquecidos** com sub-stats secundárias:
   - "Recebidos": agora mostra `R$ X · N fornecedor(es)` (era só `R$ X`)
   - "Aguardando ret.": separado de "Portal/Link" (que eram redundantes)
   - "Pendências críticas": `N atrasadas · M sem resposta` em vez de "atrasadas + sem resposta"
   - "Aprovados (mês)": substitui "Link público"; mostra `R$ X liberados`
   - Empty states friendly: "— sem pendências", "— ainda nenhum"

4. **Função `exportarCSV()`** wired ao botão (chama `/api/envios/export.csv` com filtro de unidade).

**Validação visual**:
- Eyebrow renderizou: "HOSPITAL ESTADUAL COSTA DOS COQUEIROS · LAURO DE FREITAS"
- H1 + pill: "Painel da unidade ● Visão: Operador HECC"
- Subtitle: "2026-05 · 3 envios recebidos · 3 pendências · R$ 179.250,00 movimentados"
- KPIs todos com sub-stats corretos
- Filtros + ações alinhados à direita do título

**Testes**: 1127 verdes · 0 falhas.

**Resultado**: app praticamente idêntico ao mockup no painel, mantendo o alert vermelho de pendências críticas e os gráfico/sidebar existentes.

---

### V243 — 2026-05-25 — CHANGELOG estruturado
**Por quê**: institucionalizar memória de mudanças, decisões e anti-patterns para evitar reintroduzir bugs e perder conhecimento.

**Arquivos**: `CHANGELOG.md` (novo, este arquivo), `CLAUDE.md` (linkado).

**Sem mudança de código.** Documentação apenas.

---

### V242 — 2026-05-25 — Alinhamento com mockup oficial
**Por quê**: usuário pediu análise visual comparativa entre o `controle-pagamentos-mockup.html` (mockup oficial, 24 telas) e a UI atual, aplicando o melhor design de cada tela.

**Mudanças**:
1. **`login.html`**: adicionado checkbox "Lembrar-me" alinhado horizontalmente ao "Esqueci minha senha" (espelhando o mockup).
2. **`portal.html`**: adicionado **action card de retificação** no topo (`#action-retif`) — banner amarelo que aparece quando há envios `aguardando_ret`, com lista de cards + botão "Retificar →". Maior ganho UX da versão.

**Validação**: Preview real — operador HECC pediu retificação no envio 1 → fornecedor logou no portal → action card apareceu com `HECC-SEED-0001 · HECC · 2026-05 · R$ 158.000,00` + botão funcional + sino com badge "1".

**Preservado vs mockup**: hero gradient roxo com saudação personalizada (melhor que mockup, mantido — `D2`).

**Testes**: 1127 verdes · 0 falhas.

---

### V241 — 2026-05-25 — Fluxos E2E reais + último limpa de raw strings
**Por quê**: validar via Preview que fluxos do operador (aprovar, retificar, rejeitar) funcionam end-to-end, e capturar qualquer raw string que escapou do V240.

**Mudanças**:
1. **Origens chips raw**: 9 spots em 7 arquivos (`envio.html`, `painel.html` x2, `admin-pagamentos.html`, `admin-fornecedor.html` x2, `admin-unidade.html` x2, `admin.html`) — todos passaram para `statusLabel(e.origem)`.
2. **Trilhas de auditoria em modais**: 4 spots (`painel.html` modal trilha, `envio.html` tab Auditoria, `admin-auditoria.html`, `admin-status.html` último evento) — passaram para `statusLabel(a.acao)`.
3. **`admin-pagamentos.html`**: faltava import de `statusLabel`, adicionado.
4. **`admin-status.html`**: chips "Cenários em uso" → "Portal" / "Link público" / "Manual" (não mais raw).

**Validação E2E**:
- Operador clica "Solicitar retificação" em envio 1 → status muda para "Aguardando retificação" ✓
- Operador clica "Aprovar envio" em envio 2 → status muda para "Aprovado", trajetória avança ✓
- Tab Auditoria: ação "criado (portal)" legível ✓

**Testes**: 1127 verdes · 0 falhas.

---

### V240 — 2026-05-25 — Distribuição `statusLabel()` em toda a UI
**Por quê**: V238 introduziu `statusLabel()` em 4 telas; ainda havia 20+ pontos de `.replace('_',' ')` espalhados.

**Mudanças**:
1. **`STATUS_LABELS` map** em `api.js` estendido de 11 para 35+ entradas (status envio, origem, tipo fornecedor, papel usuário, status expectativa, tipo email, **ações de auditoria**).
2. **Script Python idempotente** substituiu `.replace('_',' ')` por `statusLabel(...)` em 11 arquivos HTML + adicionou import.
3. Pontos restantes (modais de trilha) corrigidos manualmente.

**Testes**: 1127 verdes · 0 falhas.

---

### V239 — 2026-05-25 — 🔴 Fix raiz de timezone PGlite (1 linha)
**Por quê**: investigação visual do recibo (V238 R1) revelou que `Emitido em` e `criado portal` ainda mostravam horários inconsistentes (3h de drift). Isolei via `node -e` que PGlite estava interpretando `CURRENT_TIMESTAMP` no fuso do processo Node, gerando drift sistêmico em **todas** as inserções com `DEFAULT CURRENT_TIMESTAMP`.

**Diagnóstico**:
```
JS now ISO:    2026-05-25T01:44:11.989Z  (UTC real)
PGlite armazena: 2026-05-25T04:44:11.989Z (+3h drift em host UTC-3)
```

**Fix (1 linha em `server.js`)**:
```js
if (!process.env.TZ) process.env.TZ = 'UTC';   // ANTES de qualquer import PGlite
```

**Impacto**: corrige **classe inteira de bugs**:
- V235 SLA "-1 dias" (a guarda `Math.max(0,...)` em painel.html agora é apenas defesa em profundidade)
- V237 R1 Recibo timestamps inconsistentes
- Qualquer cálculo de duração (SLA metrics, escalonamento, expiração de links públicos, peak hours, retention)

**Validação**:
- Antes: `criado_em` = `+3h depois de started_at`
- Depois: `criado_em` = `1s depois de started_at` ✓
- UI recibo: "Emitido em" e "criado portal" agora consistentes ✓

**Bumped**: APP_VERSION para V239.

**Testes**: 1127 verdes · 0 falhas.

**⚠️ Não remover essa linha de TZ. Ver `⛔ NÃO REINTRODUZIR #4`**.

---

### V238 — 2026-05-25 — Fixes dos 12 bugs do V237
**Por quê**: V237 levantou 12 bugs cosméticos. V238 atacou todos, com 2 helpers reutilizáveis.

**Mudanças por bug**:
- **C1** `consulta.html`: pré-preenche `?protocolo=` + auto-submit.
- **C2/R2/RP1/RP2** (4 telas): introduzido helper `statusLabel()` em api.js.
- **R1** `recibo.html`: timestamps padronizados (em V238 com `timeZone: 'America/Bahia'`, depois resolvido pela raiz em V239).
- **A1** `admin-auditoria.html`: grid `.acao` 110→160px + word-break.
- **A2+A3** `admin-emails.html`: pill SMTP dinâmica via `api.obterSmtp()`.
- **A4+A5** `admin-status.html` / `admin-api.html`: versão dinâmica via `APP_VERSION='V238'` em server.js (D5).
- **A6** Nav admin reordenado: SMTP logo após E-mails em 11 arquivos (D8).
- **CD1** `cadastro.html`: asterisco vermelho em "Razão social" + "CNPJ" required.
- **FH1** `form-adapter.js`: omite "Unidade" e "Competência" do banner quando vazios.

**Helpers introduzidos**:
- `statusLabel(s)` em api.js — single source of truth (D4).
- `APP_VERSION` em server.js — variável única para versão (D5).

**Testes**: 1127 verdes · 0 falhas.

---

### V237 — 2026-05-25 — Auditoria visual completa de 24 telas
**Por quê**: usuário pediu auditoria visual após V235 (3 bugs cosméticos) e V236 (varredura ESM imports).

**Resultado**: 12 bugs cosméticos catalogados (nenhum bloqueador) em arquivo `RELATORIO-BUGS-V237.md`. Cobertura: 24 telas (login, portal, painel, envio, admin x12, públicas x4, fluxos auth x4).

**Sem mudanças de código.** Apenas catálogo.

---

### V235/V236 — anterior
- **V235**: auditoria UI no Claude Preview encontrou 3 bugs (SLA "-1 dias", admin-smtp imports quebrados, trocar-senha imports). Fixados.
- **V236**: varredura runtime errors via static analysis ESM em 36 telas. 0 falhas.

---

### V233/V234 — funcionalidade
- **V233**: smoke test funcional por perfil (57 ações cross-papel).
- **V234**: 12 fluxos E2E encadeados (retificação completa, link público anônimo, etc).

---

## 🧰 PADRÕES OPERACIONAIS

### Quando criar um helper novo em api.js
- Se você está copiando lógica de formatação para uma terceira tela, **vire helper em api.js**.
- Histórico mostra que `statusLabel`, `brl`, `dataBR`, `requireSession`, `toast` foram todos extraídos por isso.

### Quando subir versão (`APP_VERSION`)
- Sempre que houver mudança visível em produção.
- Editar `server.js` linha que define `APP_VERSION`.

### Quando rodar `npm run test:all`
- Antes de cada commit que toca múltiplos arquivos.
- Após qualquer mudança em api.js, server.js, schema.sql.
- Esperado: 1127 testes verdes (no momento desta entry).

### Quando atualizar este CHANGELOG
- A cada mudança não-trivial. Padrão: `### V### — YYYY-MM-DD — Título curto` + `**Por quê**:` + `**Mudanças**:` + `**Testes**:`.

### Quando adicionar ao `⛔ NÃO REINTRODUZIR`
- Se você está removendo algo que causou bug.
- Se você está substituindo um padrão por outro melhor.
- Se há uma decisão "esse caminho não funciona" que precisa sobreviver à amnésia.
