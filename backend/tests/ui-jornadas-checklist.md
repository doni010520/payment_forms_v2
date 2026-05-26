# Auditoria de Jornadas (Fase 3) — Checklist

Documenta as fricções **lógicas / UX** encontradas simulando cada persona, separadas da Fase 2 (estática).

## Fase 3A — Fornecedor com portal (V214 ✅)

| ID | Severidade | Status | Detalhe |
|---|---|---|---|
| F1.1 | 🟢 UX | TODO #217 | Erro "CPF/CNPJ invalido" sem dizer por quê (dígito? formato?) |
| F1.2 | 🔴 SMTP | em #214 | Senha temporária só em alert do admin — fornecedor não recebe automaticamente |
| F1.3 | 🟡 UX | TODO #216 | Nome "Contato · {razao_social}" gerado sem input do usuário |
| F1.4 | 🟡 segurança | TODO #215 | Senha temp pode ser usada para sempre — sem força-troca |
| **F1.5** | 🔴 funcional | **✅ corrigido** | portal-novo mostrava 8 unidades; agora só as do fornecedor (`/api/me/unidades`) |
| **F2.1** | 🔴 funcional | **✅ corrigido** | Notif com `?envio=X` ignorada — portal e painel agora abrem modal direto |
| **F3.1** | 🟡 funcional | **✅ corrigido** | Comentários com tipo `sistema` não respeitavam V192 prefs — agora `novo_comentario` |
| **F3.2** | 🟡 UX | **✅ corrigido** (junto F2.1) | Notif de comentário pro fornecedor não abria modal |

## Fase 3B — Fornecedor anônimo via link público (em progresso)

| ID | Severidade | Status | Detalhe |
|---|---|---|---|
| F7.1 | 🔴 SMTP | em #214 | Link gerado, mas **não enviado por email** — operador copia/cola manualmente |
| **F7.3** | 🔴🔴🔴 **CRÍTICO** | **TODO #219** | **TODOS os 6 formulários HTML não chamam backend** — só persistem em localStorage. Fornecedor pensa que enviou; nada chega à FESF. Invalida cenários 1 e 2. |
| F7.4 | ✅ ok | — | Consulta por protocolo funciona, dados sensíveis ocultos |
| F7.5 | ✅ ok | — | Revogação + ja_utilizado retornam `motivoInvalido` distintos; publico.html trata |
| F7.6 | ✅ ok | — | Recibo público funciona via protocolo |
| F7.2 | (falso alarme) | — | sucesso.html que exige auth não é usado neste fluxo — formulário tem view-success próprio |

## Fase 3C — Operador (pendente)
## Fase 3D — Admin (pendente)

## Sumário de descobertas críticas
- **#219 (F7.3)**: maior bug encontrado até hoje. Formulários desconectados do backend. **Necessita refatoração de 6 arquivos grandes** (>2000 linhas cada).
- **#214 (SMTP)**: gap conhecido, planejado.
- **#215/216/217**: melhorias UX/segurança (não-críticas).
