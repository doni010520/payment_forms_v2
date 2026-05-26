# Portal de Pagamentos FESF-SUS

Sistema de coleta, validação e rastreabilidade de pagamentos entre a FESF Sede (Fundação Estatal Saúde da Família) e seus fornecedores, atendendo a rede de unidades hospitalares (HECC, MRC, HMI, PN, PE, CAPS-MSJ, SVO, SEDE).

## Stack

- **Backend**: Node.js + Express (ES modules)
- **Banco**: PostgreSQL (via PGlite em dev, Postgres real em prod via `DATABASE_URL`)
- **Auth**: JWT + sessão revogável
- **Frontend**: vanilla HTML/CSS/JS (sem framework)
- **Storage**: local (`/uploads`) ou OneDrive/SharePoint (Microsoft Graph API)
- **Email**: SMTP configurável (com simulador em dev)

## Setup local (desenvolvimento)

```bash
cd backend
npm install
npm start            # http://localhost:3000
```

Banco PGlite é criado automaticamente em `.pgdata/` no primeiro start, com seed de dados realistas (8 unidades, 8 fornecedores, 7 usuários, alguns envios de exemplo).

### Credenciais de demo (senha `senha123`)

- **Admin FESF**: `maria.andrade@fesfsus.ba.gov.br`
- **Operador HECC**: `carlos.souza@fesfsus.ba.gov.br`
- **Fornecedor**: `contato@empresahosp.com.br`

## Comandos úteis

```bash
npm start            # sobe servidor
npm test             # roda flows.test apenas
npm run test:all     # roda toda a suite (1127 testes)
npm run reset        # apaga banco + uploads e refaz seed
npm run demo         # demo mode (sem escalonamento automático)
```

## Variáveis de ambiente (produção)

```bash
# OBRIGATÓRIO em produção
APP_ENCRYPTION_KEY="<chave-32+chars-alta-entropia>"   # encripta secrets (SMTP, OneDrive)
JWT_SECRET="<chave-jwt-aleatoria>"                     # assina tokens
DATABASE_URL="postgres://user:pass@host:5432/db"       # PG real (sem isso, usa PGlite local)

# OPCIONAL
APP_VERSION="V299"                                     # default no código
PORT="3000"
LOG_QUIET="0"                                          # 1 = silencia logs JSON
RATE_LIMIT_DISABLED="0"                                # 1 = desliga rate limit (só dev/test)
ESCALONAMENTO_INTERVALO_MS="300000"                    # 5min default
CORS_ALLOWED_ORIGINS="https://portal.fesfsus.ba.gov.br"
```

## Documentos importantes

- `CHANGELOG.md` — **leia antes de qualquer alteração**. Contém:
  - ⛔ Anti-patterns conhecidos (não reintroduzir)
  - 🎯 Decisões de design (preservar)
  - 📜 Histórico versionado V1...V299
- `CLAUDE.md` — Memória do projeto (instruções para agentes IA que mexerem no código)
- `PROGRESSO-MOCKUP.md` — Alinhamento visual com mockup oficial
- `controle-pagamentos-mockup.html` — Mockup de referência

## Estrutura do projeto

```
backend/
├── server.js                  # Bootstrap Express + middleware
├── db/
│   ├── schema.sql             # Schema PostgreSQL
│   ├── seed.js                # Seed de dados de exemplo
│   ├── index.js               # Adapter PGlite/PG
│   └── migrations/            # Migrações incrementais
├── routes/                    # Endpoints REST
│   ├── auth.js
│   ├── envios.js
│   ├── storage.js             # Config OneDrive admin
│   └── ...
├── services/                  # Lógica de negócio
│   ├── auth-service.js
│   ├── storage-service.js     # Abstração local/OneDrive
│   ├── crypto-helper.js       # AES-256-GCM
│   └── ...
├── public/app/                # Frontend (35+ páginas HTML)
│   ├── login.html
│   ├── portal.html            # Fornecedor
│   ├── painel.html            # Operador
│   ├── admin*.html            # Admin FESF
│   ├── api.js                 # Cliente REST
│   ├── form-adapter.js        # Bridge formulários HCC ↔ API
│   └── style.css
└── tests/                     # Suite (1127 testes)
```

## Deploy

Arquitetura recomendada (descrita em CHANGELOG V298):
- **Frontend** (estáticos): Vercel free
- **Backend** (Express): Render/Railway free
- **Banco**: Neon ou Supabase Postgres free
- **Storage**: OneDrive/SharePoint da FESF (via Microsoft Graph API)

## Licença

Uso interno da Fundação Estatal Saúde da Família — FESF-SUS.
