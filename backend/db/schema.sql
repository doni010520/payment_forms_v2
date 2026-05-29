-- =====================================================================
-- Portal de Pagamentos FESF-SUS · Schema PostgreSQL
-- =====================================================================
-- Suporta os 3 cenarios de envio:
--  1. Fornecedor logado (origem = 'portal')
--  2. Fornecedor sem login via link publico (origem = 'link_publico')
--  3. Fornecedor que nao responde -> operador lanca manual (origem = 'manual')
-- =====================================================================

-- ---------------------------------------------------------------------
-- UNIDADES (HECC, MRC, HMI Ilheus, etc.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unidades (
  id           SERIAL PRIMARY KEY,
  sigla        TEXT NOT NULL UNIQUE,          -- HECC, MRC, etc.
  nome         TEXT NOT NULL,                  -- Hospital Estadual Costa dos Coqueiros
  cidade       TEXT NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'BA',
  ativa        BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_unidades_sigla ON unidades(sigla);

-- ---------------------------------------------------------------------
-- FORNECEDORES (PJ ou PF, com portal ou externo)
-- ---------------------------------------------------------------------
-- tipo:
--   'com_portal'  -> autoservico, tem conta, recebe notificacoes
--   'externo_pj'  -> PJ externo, sem login, operador opera por ele
--   'externo_pf'  -> PF externo (autonomo, profissional liberal)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fornecedores (
  id              SERIAL PRIMARY KEY,
  tipo            TEXT NOT NULL CHECK (tipo IN ('com_portal', 'externo_pj', 'externo_pf')),
  razao_social    TEXT NOT NULL,
  nome_fantasia   TEXT,
  documento       TEXT NOT NULL UNIQUE,         -- CNPJ (PJ) ou CPF (PF), so digitos
  email           TEXT,                          -- pode ser NULL para PF sem email
  telefone        TEXT,
  nome_contato    TEXT,                          -- V229/F1.3: pessoa responsavel pelas comunicações
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  pendente_aprovacao BOOLEAN NOT NULL DEFAULT FALSE,
  status_engajamento TEXT NOT NULL DEFAULT 'ativo'
                  CHECK (status_engajamento IN ('ativo', 'inadimplente', 'inativo')),
  motivo_engajamento TEXT,                              -- justificativa quando inadimplente
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por_unidade_id INTEGER REFERENCES unidades(id)  -- quando cadastrado por uma unidade
);

CREATE INDEX IF NOT EXISTS idx_fornecedores_documento ON fornecedores(documento);
CREATE INDEX IF NOT EXISTS idx_fornecedores_tipo ON fornecedores(tipo);
CREATE INDEX IF NOT EXISTS idx_fornecedores_email ON fornecedores(email);

-- Relacao N:N entre fornecedor e unidades que ele atende
CREATE TABLE IF NOT EXISTS fornecedor_unidades (
  fornecedor_id INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
  unidade_id    INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fornecedor_id, unidade_id)
);

-- ---------------------------------------------------------------------
-- USUARIOS (operadores de unidade, admins FESF, fornecedores logados)
-- ---------------------------------------------------------------------
-- papel:
--   'fornecedor'      -> usuario vinculado a um fornecedor com portal
--   'operador_unidade'-> operador de uma unidade especifica
--   'admin_fesf'      -> administrador da FESF Sede
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id              SERIAL PRIMARY KEY,
  papel           TEXT NOT NULL CHECK (papel IN ('fornecedor', 'operador_unidade', 'admin_fesf')),
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  senha_hash      TEXT NOT NULL,                          -- bcrypt
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  fornecedor_id   INTEGER REFERENCES fornecedores(id),    -- se papel='fornecedor'
  unidade_id      INTEGER REFERENCES unidades(id),        -- se papel='operador_unidade'
  primeiro_acesso BOOLEAN NOT NULL DEFAULT TRUE,           -- vira FALSE depois do primeiro login
  -- V226/F1.4: TRUE quando senha foi gerada pelo sistema (cadastro/reset/aprovação).
  -- Bloqueia operações de escrita até o usuário trocar a senha em /api/me/senha.
  senha_temporaria_ativa BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_login    TIMESTAMP,
  notif_prefs     TEXT,                                     -- JSON: { novo_envio, status_envio, comentarios, pagamento } (default todos true)
  -- garantir que o papel tem o relacionamento certo
  CONSTRAINT chk_papel_relacionamento CHECK (
    (papel = 'fornecedor'       AND fornecedor_id IS NOT NULL AND unidade_id IS NULL) OR
    (papel = 'operador_unidade' AND unidade_id IS NOT NULL AND fornecedor_id IS NULL) OR
    (papel = 'admin_fesf'       AND unidade_id IS NULL AND fornecedor_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_papel ON usuarios(papel);

-- ---------------------------------------------------------------------
-- MODALIDADES de pagamento
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modalidades (
  id          SERIAL PRIMARY KEY,
  codigo      TEXT NOT NULL UNIQUE,    -- ex: 'indenizatorio_moe', 'pagamento_insumos'
  nome        TEXT NOT NULL,           -- ex: 'Pagamento Indenizatório · Mão de Obra Exclusiva'
  categoria   TEXT NOT NULL CHECK (categoria IN ('indenizatorio', 'normal')),
  formulario  TEXT,                    -- nome do arquivo do formulario (ex: 'formulario-hcc.html')
  documentos_esperados TEXT,           -- JSON array de {campo, label, obrigatorio} esperados
  ativa       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- EXPECTATIVAS (cenario 3: registro de que se espera um envio)
-- ---------------------------------------------------------------------
-- status:
--   'aguardando'   -> registrada, prazo ainda em dia, sem lembrete
--   'lembrado'     -> 1o ou 2o lembrete enviado
--   'sem_resposta' -> X dias apos prazo sem envio
--   'atrasada'     -> Y dias apos prazo, exige acao
--   'cancelada'    -> operador cancelou com justificativa
--   'cumprida'     -> virou um envio (status final)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expectativas (
  id                  SERIAL PRIMARY KEY,
  fornecedor_id       INTEGER NOT NULL REFERENCES fornecedores(id),
  unidade_id          INTEGER NOT NULL REFERENCES unidades(id),
  modalidade_id       INTEGER NOT NULL REFERENCES modalidades(id),
  competencia         TEXT NOT NULL,             -- 'YYYY-MM' (ex: '2026-05')
  prazo               DATE NOT NULL,
  origem_prevista     TEXT NOT NULL CHECK (origem_prevista IN ('portal', 'link_publico', 'manual')),
  cadencia_json       TEXT,                       -- regras opcionais de lembrete: {antes:[5,1], depois:[1,3,7]}
  status              TEXT NOT NULL DEFAULT 'aguardando'
                      CHECK (status IN ('aguardando', 'lembrado', 'sem_resposta', 'atrasada', 'cancelada', 'cumprida')),
  envio_id            INTEGER,                   -- preenchido quando vira envio
  observacoes         TEXT,
  motivo_cancelamento TEXT,
  criada_por_usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criada_em           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizada_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expectativas_unidade ON expectativas(unidade_id);
CREATE INDEX IF NOT EXISTS idx_expectativas_fornecedor ON expectativas(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_expectativas_status ON expectativas(status);
CREATE INDEX IF NOT EXISTS idx_expectativas_prazo ON expectativas(prazo);

-- ---------------------------------------------------------------------
-- LINKS PUBLICOS (cenario 2: envio sem login)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links_publicos (
  id              SERIAL PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,           -- token aleatorio na URL
  fornecedor_id   INTEGER REFERENCES fornecedores(id),
  unidade_id      INTEGER NOT NULL REFERENCES unidades(id),
  modalidade_id   INTEGER NOT NULL REFERENCES modalidades(id),
  expectativa_id  INTEGER REFERENCES expectativas(id),
  email_destinatario TEXT,                         -- para quem o link foi enviado
  expira_em       TIMESTAMP,                       -- NULL = sem expiracao
  uso_multiplo    BOOLEAN NOT NULL DEFAULT FALSE,
  usos            INTEGER NOT NULL DEFAULT 0,
  usos_max        INTEGER,                          -- V227/O6: NULL = ilimitado (so se uso_multiplo=TRUE); ou N usos no maximo
  criado_por_usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revogado        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_links_token ON links_publicos(token);
CREATE INDEX IF NOT EXISTS idx_links_unidade ON links_publicos(unidade_id);

-- ---------------------------------------------------------------------
-- ENVIOS (a submissao em si)
-- ---------------------------------------------------------------------
-- origem:
--   'portal'        -> fornecedor logado submeteu pelo portal
--   'link_publico'  -> fornecedor anonimo submeteu via link
--   'manual'        -> operador da unidade lancou em nome do fornecedor
-- ---------------------------------------------------------------------
-- status:
--   'em_analise'        -> recebido, aguardando analise da unidade
--   'aguardando_ret'    -> unidade pediu retificacao
--   'retificado'        -> fornecedor enviou retificacao
--   'aprovado'          -> unidade aprovou
--   'rejeitado'         -> unidade rejeitou
--   'pago'              -> pagamento realizado (FESF Sede)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS envios (
  id                SERIAL PRIMARY KEY,
  protocolo         TEXT NOT NULL UNIQUE,            -- ex: 'HECC-3935-8035'
  fornecedor_id     INTEGER NOT NULL REFERENCES fornecedores(id),
  unidade_id        INTEGER NOT NULL REFERENCES unidades(id),
  modalidade_id     INTEGER NOT NULL REFERENCES modalidades(id),
  competencia       TEXT NOT NULL,                    -- 'YYYY-MM'
  origem            TEXT NOT NULL CHECK (origem IN ('portal', 'link_publico', 'manual')),
  status            TEXT NOT NULL DEFAULT 'em_analise'
                    CHECK (status IN ('em_analise', 'aguardando_ret', 'retificado', 'aprovado', 'rejeitado', 'pago')),
  valor_centavos    BIGINT NOT NULL DEFAULT 0,        -- valor em centavos (R$ 1.234,56 = 123456)
  numero_nf         TEXT,
  descricao         TEXT,
  -- quem submeteu
  submetido_por_usuario_id INTEGER REFERENCES usuarios(id),  -- NULL se anonimo via link
  submetido_por_nome       TEXT,                              -- nome textual (caso anonimo)
  submetido_por_documento  TEXT,                              -- CPF/CNPJ do submetente
  -- contexto adicional
  link_publico_id   INTEGER REFERENCES links_publicos(id),
  expectativa_id    INTEGER REFERENCES expectativas(id),
  -- motivo (so para manual)
  motivo_manual     TEXT,                              -- exigido para origem='manual'
  -- timestamps
  criado_em         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_envios_protocolo ON envios(protocolo);
CREATE INDEX IF NOT EXISTS idx_envios_unidade ON envios(unidade_id);
CREATE INDEX IF NOT EXISTS idx_envios_fornecedor ON envios(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_envios_origem ON envios(origem);
CREATE INDEX IF NOT EXISTS idx_envios_status ON envios(status);
CREATE INDEX IF NOT EXISTS idx_envios_competencia ON envios(competencia);

-- Constraint: origem='manual' exige motivo
-- (CHECK simulada via trigger seria melhor; aqui declaramos so na app layer)

-- ---------------------------------------------------------------------
-- VERSOES DE ENVIO (retificacoes geram novas versoes)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS versoes_envio (
  id            SERIAL PRIMARY KEY,
  envio_id      INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  numero        INTEGER NOT NULL,                -- 1, 2, 3...
  dados_json    TEXT NOT NULL,                   -- snapshot dos dados do form
  criada_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (envio_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_versoes_envio ON versoes_envio(envio_id);

-- ---------------------------------------------------------------------
-- DOCUMENTOS anexados
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documentos (
  id            SERIAL PRIMARY KEY,
  envio_id      INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  versao_id     INTEGER REFERENCES versoes_envio(id),
  campo         TEXT NOT NULL,                   -- qual campo do form (ex: 'nf_pdf', 'crf_estadual')
  nome_original TEXT NOT NULL,
  mime_type     TEXT,
  tamanho_bytes BIGINT,
  caminho       TEXT NOT NULL,                   -- onde foi salvo no disco
  hash_sha256   TEXT,                             -- hash SHA-256 do conteudo (anti-fraude)
  uploaded_por_id   INTEGER REFERENCES usuarios(id),  -- quem fez upload (NULL se via link publico)
  uploaded_por_nome TEXT,                              -- nome textual no momento do upload
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documentos_envio ON documentos(envio_id);
CREATE INDEX IF NOT EXISTS idx_documentos_hash ON documentos(hash_sha256);

-- ---------------------------------------------------------------------
-- LEMBRETES enviados
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lembretes (
  id              SERIAL PRIMARY KEY,
  expectativa_id  INTEGER NOT NULL REFERENCES expectativas(id) ON DELETE CASCADE,
  numero          INTEGER NOT NULL,              -- 1=primeiro, 2=segundo, 3=urgente, etc.
  canal           TEXT NOT NULL CHECK (canal IN ('email', 'portal', 'sms', 'whatsapp')),
  enviado_em      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_por_usuario_id INTEGER REFERENCES usuarios(id),  -- NULL se automatico
  conteudo        TEXT
);

CREATE INDEX IF NOT EXISTS idx_lembretes_expectativa ON lembretes(expectativa_id);

-- ---------------------------------------------------------------------
-- AUDITORIA (trilha completa)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
  id            SERIAL PRIMARY KEY,
  entidade      TEXT NOT NULL,                   -- 'envio', 'expectativa', 'fornecedor', etc.
  entidade_id   INTEGER NOT NULL,
  acao          TEXT NOT NULL,                   -- 'criado', 'aprovado', 'rejeitado', 'lembrete_enviado', etc.
  usuario_id    INTEGER REFERENCES usuarios(id), -- NULL para acoes anonimas (link publico)
  detalhe       TEXT,
  ip            TEXT,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_acao ON auditoria(acao);

-- ---------------------------------------------------------------------
-- NOTIFICACOES (in-app) — entregue ao usuario destinatario
-- ---------------------------------------------------------------------
-- tipo:
--   'novo_envio'           -> operador recebeu um envio novo
--   'retificacao_solicitada' -> fornecedor recebeu pedido de retificacao
--   'envio_aprovado'       -> fornecedor avisado
--   'envio_rejeitado'      -> fornecedor avisado
--   'lembrete_enviado'     -> fornecedor (in-app + email externo)
--   'pendencia_sem_resposta' -> operador foi alertado
--   'pendencia_atrasada'   -> operador foi alertado
--   'sistema'              -> mensagens diversas do sistema
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificacoes (
  id            SERIAL PRIMARY KEY,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,
  mensagem      TEXT NOT NULL,
  link          TEXT,                            -- caminho relativo ex: /app/painel.html?envio=123
  entidade      TEXT,                            -- 'envio', 'expectativa', etc.
  entidade_id   INTEGER,
  lida          BOOLEAN NOT NULL DEFAULT FALSE,
  criada_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id, lida);
CREATE INDEX IF NOT EXISTS idx_notificacoes_criada ON notificacoes(criada_em DESC);

-- ---------------------------------------------------------------------
-- COMENTARIOS (thread de discussao em cada envio)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comentarios (
  id            SERIAL PRIMARY KEY,
  envio_id      INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  usuario_id    INTEGER REFERENCES usuarios(id),
  texto         TEXT NOT NULL,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comentarios_envio ON comentarios(envio_id, criado_em);

-- ---------------------------------------------------------------------
-- EMAILS SIMULADOS — em producao seriam enviados via SMTP real.
-- Mantemos registro do que seria enviado para transparencia/auditoria.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emails_simulados (
  id              SERIAL PRIMARY KEY,
  destinatario    TEXT NOT NULL,
  assunto         TEXT NOT NULL,
  corpo           TEXT NOT NULL,
  tipo            TEXT NOT NULL,                  -- aprovado, rejeitado, retificacao, lembrete, esqueci_senha, novo_envio, sistema
  entidade        TEXT,                            -- envio, expectativa, fornecedor, usuario
  entidade_id     INTEGER,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visualizado     BOOLEAN NOT NULL DEFAULT FALSE,
  -- V214: envio via SMTP real
  enviado_real    BOOLEAN NOT NULL DEFAULT FALSE,
  erro_envio      TEXT,
  smtp_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_emails_destinatario ON emails_simulados(destinatario, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_emails_tipo ON emails_simulados(tipo);

-- ---------------------------------------------------------------------
-- ANOTACOES DE ANALISE — operador marca cada campo do form como
-- verificado / duvida / problema durante a analise documental.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anotacoes_envio (
  id            SERIAL PRIMARY KEY,
  envio_id      INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  campo         TEXT NOT NULL,                        -- ex: q1_nomeFornecedor, q10_nfNumero
  status        TEXT NOT NULL CHECK (status IN ('verificado','duvida','problema','comentario')),
  observacao    TEXT,
  operador_id   INTEGER NOT NULL REFERENCES usuarios(id),  -- ÚLTIMO que tocou (V231/O2: ver criado_por_id)
  criado_por_id INTEGER REFERENCES usuarios(id),       -- V231/O2: criador original (preservado)
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (envio_id, campo)
);

CREATE INDEX IF NOT EXISTS idx_anotacoes_envio ON anotacoes_envio(envio_id);

-- ---------------------------------------------------------------------
-- ANOTACOES DE DOCUMENTO — operador marca cada arquivo individual como
-- verificado / duvida / problema na aba Documentos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anotacoes_documento (
  id            SERIAL PRIMARY KEY,
  documento_id  INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  envio_id      INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('verificado','duvida','problema','comentario')),
  observacao    TEXT,
  operador_id   INTEGER NOT NULL REFERENCES usuarios(id),  -- ÚLTIMO que tocou
  criado_por_id INTEGER REFERENCES usuarios(id),       -- V231/O2: criador original
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (documento_id)
);

CREATE INDEX IF NOT EXISTS idx_anotdoc_envio ON anotacoes_documento(envio_id);

-- ---------------------------------------------------------------------
-- PAGAMENTOS — registro estruturado da liberação financeira
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagamentos (
  id              SERIAL PRIMARY KEY,
  envio_id        INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  numero_ted      TEXT NOT NULL,                   -- nº TED/transferencia
  banco_pagador   TEXT NOT NULL,                   -- ex: 'Banco do Brasil', 'Caixa'
  data_efetiva    DATE NOT NULL,                   -- data da liquidacao
  valor_pago_centavos BIGINT NOT NULL,
  observacao      TEXT,
  comprovante_doc_id INTEGER REFERENCES documentos(id),  -- doc de comprovante (opcional)
  registrado_por_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_envio ON pagamentos(envio_id);

-- ---------------------------------------------------------------------
-- SOLICITACOES DE REENVIO — operador pede ao fornecedor que reenvie um doc
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitacoes_reenvio (
  id              SERIAL PRIMARY KEY,
  envio_id        INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  documento_id    INTEGER REFERENCES documentos(id) ON DELETE SET NULL,
  campo           TEXT NOT NULL,                 -- campo do form para reenvio
  motivo          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','atendida','cancelada')),
  solicitado_por  INTEGER NOT NULL REFERENCES usuarios(id),
  atendido_em     TIMESTAMP,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- V228/O3.2: prazo de atendimento + contador de tentativas
  prazo_atendimento TIMESTAMP,                    -- NULL = sem prazo (legado)
  tentativas      INTEGER NOT NULL DEFAULT 1     -- incrementa em re-solicitações do mesmo campo
);

CREATE INDEX IF NOT EXISTS idx_reenvio_envio ON solicitacoes_reenvio(envio_id);

-- ---------------------------------------------------------------------
-- CONFIGURACOES — chave/valor JSON para parametros globais editaveis
-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- USUARIO_UNIDADES — operador pode atender mais de uma unidade
-- A unidade "primária" continua em usuarios.unidade_id (compatibilidade);
-- esta tabela ADICIONA unidades extras opcionais.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_unidades (
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  unidade_id    INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, unidade_id)
);

CREATE INDEX IF NOT EXISTS idx_uu_usuario ON usuario_unidades(usuario_id);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,             -- JSON serializado
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por INTEGER REFERENCES usuarios(id)
);

-- Revogacao de sessao: 1 linha por usuario com "revogue tudo emitido antes de X"
-- Epoch em segundos (BIGINT) evita ambiguidade de timezone com TIMESTAMP.
CREATE TABLE IF NOT EXISTS revogacao_sessao (
  usuario_id          INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  revogado_apos_epoch BIGINT NOT NULL,
  revogado_por        INTEGER REFERENCES usuarios(id),
  motivo              TEXT,
  criado_em           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Housekeeping runs: registra execucoes de jobs periodicos (cron interno).
-- UNIQUE(job, data_execucao_dia) garante single-instance em ambientes HA.
CREATE TABLE IF NOT EXISTS housekeeping_runs (
  id                  SERIAL PRIMARY KEY,
  job                 TEXT NOT NULL,
  data_execucao_dia   DATE NOT NULL DEFAULT CURRENT_DATE,
  iniciado_em         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizado_em       TIMESTAMP,
  status              TEXT NOT NULL DEFAULT 'em_andamento',
  resultado           TEXT,
  erro                TEXT,
  UNIQUE (job, data_execucao_dia)
);
CREATE INDEX IF NOT EXISTS idx_housekeeping_data ON housekeeping_runs(data_execucao_dia DESC);
