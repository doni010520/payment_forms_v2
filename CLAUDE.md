# Memoria do Projeto - Lucas Monte (FESF-SUS)

## ⚠️ ANTES DE QUALQUER ALTERACAO

**Consulte `CHANGELOG.md` na raiz do projeto.** Ele contem:

1. **⛔ NÃO REINTRODUZIR** — anti-patterns conhecidos que ja causaram bugs. NAO refaca.
2. **🎯 DECISÕES DE DESIGN** — escolhas conscientes (ex: layout sem cor para impressao). Preserve.
3. **📜 HISTÓRICO** — o que foi feito em cada versao e por que.
4. **🧰 PADRÕES OPERACIONAIS** — quando subir versao, criar helper, rodar testes.

Toda mudanca nao-trivial DEVE ser registrada no `CHANGELOG.md` com:
- `**Por que**` (motivacao)
- `**Mudancas**` (arquivos + escopo)
- `**Testes**` (resultado da suite)

---

## 🏗️ Stack & Infraestrutura

- **Backend**: Node.js + Express em `/backend/`
- **Frontend**: HTML/JS vanilla em `/backend/public/app/` (UI logada) e `/backend/public/` (recursos)
- **Formulários públicos**: `/formulario-hcc*.html` na raiz do projeto (6 modalidades, servidos por `express.static(__dirname/..)`)
- **DB**: PostgreSQL via Supabase (project_id: `qlcfsiybidaxvdghwmxf`)
- **Storage**: Supabase Storage; caminhos `supabase://documentos/<competencia>/<uuid>-<nome>`
- **Email**: Resend HTTP API (env `RESEND_API_KEY`). ⚠️ Em sandbox o `onboarding@resend.dev` SÓ envia para `sgihecc@gmail.com` (dono da conta). Pra produção, verificar domínio em resend.com/domains
- **Deploy**: Render auto-deploy ao push em `main`. URL: https://fesf-payment-forms.onrender.com
- **GitHub**: https://github.com/doni010520/payment_forms_v2

## 🧑‍💼 Papéis e Permissões

| Papel | Escopo de leitura | Pode aprovar? | Pode pagar? |
|---|---|---|---|
| `admin_fesf` | Todas as unidades | ✓ | ✓ (único) |
| `operador_unidade` | Só sua unidade (`usuario.unidade_id` + `usuario_unidades` extras) | ✓ | ✗ |
| `fornecedor` | Só seus envios (`envios.fornecedor_id = usuario.fornecedor_id`) | ✗ | ✗ |

Fluxo padrão: `em_analise` → operador aprova → notifica admin_fesf (sino + e-mail) → admin marca pago.

## 🗄️ Modelo de Dados — Pontos críticos

- **`envios.status`**: `em_analise | aguardando_ret | retificado | aprovado | rejeitado | pago`
- **`envios.origem`**: `portal | link_publico | manual`
- **`envios.fornecedor_id`** pode ser **NULL** (link público sem fornecedor vinculado — migration 017). Sempre usar `LEFT JOIN fornecedores` em queries de listagem. Coluna FORNECEDOR no front deve cair pra `submetido_por_nome` quando NULL
- **`anotacoes_envio.status` e `anotacoes_documento.status`**: `verificado | duvida | problema | comentario` (migration 018 adicionou 'comentario', mas UI atual NÃO expõe o 4º botão — só os 3 primeiros)
- **`documentos.validacao_json`**: JSONB com `{tipo, metodo, alertas: [...], ...campos extraídos}`
- **`documentos.status_validade`**: `ok | alerta | vencido | pendente`
- **`links_publicos`**: 1 link = 1 unidade + 1 modalidade. Fornecedor é opcional (pode ser link genérico)
- Migrations SQL em `/backend/db/migrations/NNN_nome.sql` — SEMPRE refletir no `schema.sql` (source of truth para reset)

## 🤖 Validação automática de documentos

Serviço: `/backend/services/validacao-documentos-service.js`. Dispara fire-and-forget após upload (rotas autenticada E pública). Stack: `fast-xml-parser` (NF-e), `pdf-parse` (PDFs com texto), `Tesseract.js` (OCR fallback), regex pra datas de certidão.

**Códigos de alerta gerados** (em `validacao_json.alertas[]`):
- `CERTIDAO_VENCIDA` / `CERTIDAO_A_VENCER` / `VALIDADE_NAO_DETECTADA`
- `CNPJ_DIVERGENTE` / `RAZAO_DIVERGENTE` (cross-check XML vs cadastro do fornecedor)
- `VALOR_DIVERGENTE` / `NF_NUMERO_DIVERGENTE` / `COMPETENCIA_DIVERGENTE` (XML vs formulário)
- `OCR_BAIXA_CONFIANCA` / `ERRO_PROCESSAMENTO`

Quando há alerta de severidade `problema`, dispara **notificação no sino** dos operadores da unidade. **Não bloqueia** envio nem aprovação — é só observação.

## 🎨 Convenções de UI

- **Hierarquia de botões**: ação primária = solid (cor); ações secundárias/destrutivas = outline (ghost). Evita 3 botões saturados brigando pela atenção.
- **Valores monetários**: SEMPRE `white-space:nowrap` em `<td>` com `font-family:ui-monospace` (R$ não pode quebrar do número)
- **Documentos para impressão**: sem cores decorativas, sem legendas de cores, layout limpo e funcional
- **Modal de anotação**: helper `promptAnotacao({titulo, valorInicial})` em `envio.html` retorna Promise. Auto-focus, Ctrl+Enter salva, ESC cancela. Usar em vez de `prompt()` nativo
- **Aba ativa**: após qualquer ação que chama `carregar()` (anotar doc, solicitar reenvio), preservar a aba ativa lendo `document.querySelector('.dtab.active').dataset.tab` antes e re-clicar depois
- **localStorage de rascunho do form**: chave dinâmica por token público OU por modalidade (`hcc_form_pagamento_v1_pub_<token>` ou `hcc_form_pagamento_v1_<modalidade>`) — NUNCA chave fixa compartilhada entre forms

## 🛠️ Endpoints úteis (admin_fesf only)

- `GET /api/version` — build_commit e uptime
- `GET /api/admin/smtp/debug-env` — confirma se RESEND_API_KEY chegou no processo
- `POST /api/admin/smtp/test` — `{destinatario}` → testa envio
- `GET /api/emails?limit=20` — histórico (vê `erro_envio` quando falha)
- `GET /api/metricas/serie-global?granularidade=day|week|month&periodos=N` — chart agregado
- `GET /api/metricas/atividade-global?limit=N` — feed agregado

## 🐛 Pegadinhas do ambiente

- **Path com `:` literal**: `/c/Users/adoni/.../FESF/C:projetos/payment_forms`. Python no Windows quebra ao abrir esses paths direto (interpreta `C:` como drive). Sempre copiar pra `C:/Users/adoni/AppData/Local/Temp/` ou `/tmp/`, processar, copiar de volta com `cp`
- **PostgreSQL `bigint` serializa como string**: ao somar `tamanho_bytes`, fazer `Number(x)` antes do `+`, senão concatena
- **CSP**: `frame-src 'self' blob:` é necessário pra preview de PDF via `URL.createObjectURL`. NÃO usar `<a href target=_blank>` com endpoint autenticado — abre sem token e dá 401
- **Render free tier cold-start**: pode demorar 30-60s na primeira requisição. UptimeRobot configurado pra pingar `/api/version` e manter aquecido

## 👥 Credenciais de teste

- **Admin FESF**: `maria.andrade@fesfsus.ba.gov.br` / `senha123`
- **Operador HECC**: `carlos.souza@fesfsus.ba.gov.br` / `senha123`
- **Fornecedor portal**: `contato@empresahosp.com.br` / `senha123`
- Documentos de teste em `/docs_teste/` (inclui `_test_c*_*.xml/pdf` pra simular erros)

## 📚 Glossario e Siglas

- **HECC**: Hospital Estadual Costa dos Coqueiros (FESF-SUS)
- **FESF-SUS**: Fundacao Estatal Saude da Familia
- **SEI**: Sistema Eletronico de Informacoes
- **CND/CNDT/CRF**: certidões fiscais (Federal/Trabalhista/FGTS)
- **NF-e**: Nota Fiscal eletrônica (XML)

## 🤝 Processo de Trabalho

Acordo definido na revisão de 2026-06: o trabalho tem dois tamanhos, com rituais diferentes.

### Para mudanças pequenas (ajuste UX, fix cosmético, label, cor)
Fluxo livre: usuário mostra screenshot ou pede ajuste → eu corrijo → push.
Sem cerimônia. Mais rápido que processo formal.

### Para mudanças não-triviais (feature, refactor, mudança de modelo)
**Plano de 3 partes ANTES de codar**, no chat, e aguardar OK:
1. **O que muda** — em 1-2 frases
2. **Por quê** — motivação
3. **Arquivos afetados** — lista curta

Só depois do OK, executar. Evita reverter trabalho feito por causa de desalinhamento.

### Para bugs
**Identificar causa raiz EXPLICITAMENTE antes do fix.** Padrão de resposta:
- "Achei: [causa]. Vou [solução]."
- Não pular direto pro "vou consertar" sem dizer o que era.
- Quando o sintoma é cosmético mas a causa é estrutural, registrar em `⛔ NÃO REINTRODUZIR` do CHANGELOG.

### Quando algo deu errado
**Reverter rápido sem insistir.** Se uma decisão de UX não funcionou (usuário disse "ficou pior" ou "não entendi"), reverter na próxima resposta, registrar o erro em `⛔ NÃO REINTRODUZIR` se for um anti-pattern, e seguir. Não tentar justificar o trabalho perdido.

### Registro
- Toda mudança não-trivial → entrada no `CHANGELOG.md` (formato `### V### — YYYY-MM-DD — Título`)
- Padrão que já causou bug e foi removido → entrada em `⛔ NÃO REINTRODUZIR`
- Convenção nova aprendida na sessão → atualizar este `CLAUDE.md`

---

## 👤 Preferencias do Usuario

- Documentos para impressao: sem cores decorativas, sem legendas de cores, layout limpo e funcional
- Antes de remover/refazer algo, verificar `CHANGELOG.md ⛔ NÃO REINTRODUZIR` para evitar repetir bugs
- Reverter rápido quando uma decisão de UX não funcionou (não insistir só pra justificar o trabalho feito)
- Cores: paleta sóbria, ações destrutivas em outline (não sólido), pílulas/badges em tons dessaturados
