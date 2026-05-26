// =====================================================================
// OpenAPI 3.0 spec — descreve todos os endpoints públicos do sistema.
// Consumido por /api/openapi.json e exibido em /app/admin-api.html.
// =====================================================================

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'FESF-SUS Portal de Pagamentos · API',
    // version: sobrescrito em runtime por server.js (APP_VERSION). Fallback caso alguém importe o spec direto.
    version: 'unknown',
    description: 'Sistema de coleta e validação documental para pagamentos FESF aos fornecedores. Cobre 3 cenários: Portal logado, Link público sem auth, Pendência (FESF assume).',
    contact: { name: 'FESF Sede', email: 'sede@fesfsus.ba.gov.br' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Dev local' },
    { url: 'https://portal-pagamentos.fesfsus.ba.gov.br', description: 'Produção' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Envio: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, protocolo: { type: 'string' },
          fornecedor_id: { type: 'integer' }, unidade_id: { type: 'integer' }, modalidade_id: { type: 'integer' },
          competencia: { type: 'string', example: '2026-05' },
          origem: { type: 'string', enum: ['portal', 'link_publico', 'manual'] },
          status: { type: 'string', enum: ['em_analise', 'aguardando_ret', 'retificado', 'aprovado', 'rejeitado', 'pago'] },
          valor_centavos: { type: 'integer' }, numero_nf: { type: 'string' },
          criado_em: { type: 'string', format: 'date-time' },
        },
      },
      Error: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' } } },
    },
  },
  tags: [
    { name: 'Auth', description: 'Autenticação JWT' },
    { name: 'Cenário 1 · Portal', description: 'Fornecedor logado' },
    { name: 'Cenário 2 · Link público', description: 'Submissão sem autenticação' },
    { name: 'Cenário 3 · Pendências', description: 'Controle de expectativas, lembretes, conversão manual' },
    { name: 'Envios', description: 'CRUD e workflow de envios' },
    { name: 'Documentos', description: 'Upload, download, preview, anotações' },
    { name: 'Pagamentos', description: 'TED estruturado, bulk, comprovante' },
    { name: 'Fornecedores', description: 'Cadastro, aprovação, engajamento' },
    { name: 'Métricas', description: 'SLA, KPIs, séries temporais' },
    { name: 'Admin', description: 'Configuração, backup, restore, status' },
    { name: 'Auditoria', description: 'Trilha LGPD' },
  ],
  paths: {
    '/api/health': { get: { tags: ['Admin'], summary: 'Health básico', responses: { 200: { description: 'OK' } } } },
    '/api/health/detailed': { get: { tags: ['Admin'], summary: 'Snapshot operacional completo', responses: { 200: { description: 'Stats + contagens + cenários em uso' } } } },
    '/api/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Login com email/senha',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, senha: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK · retorna { token, usuario }' }, 401: { description: 'Credenciais inválidas' }, 429: { description: 'Rate limit (10/min)' } },
      },
    },
    '/api/envios/portal': {
      post: {
        tags: ['Cenário 1 · Portal', 'Envios'], summary: 'Fornecedor logado submete envio',
        security: [{ BearerAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 201: { description: 'Envio criado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envio' } } } } },
      },
    },
    '/api/envios/publico/{token}': {
      post: {
        tags: ['Cenário 2 · Link público', 'Envios'], summary: 'Submissão anônima via link público',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 201: { description: 'Envio criado anonimamente' }, 410: { description: 'Link revogado/expirado/usado' }, 429: { description: 'Rate limit (10/min)' } },
      },
    },
    '/api/envios/manual': {
      post: {
        tags: ['Cenário 3 · Pendências', 'Envios'], summary: 'Operador lança em nome do fornecedor',
        security: [{ BearerAuth: [] }],
        responses: { 201: { description: 'Envio manual criado' } },
      },
    },
    '/api/envios': { get: { tags: ['Envios'], summary: 'Lista envios (escopo por papel)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}': { get: { tags: ['Envios'], summary: 'Detalhe de envio (com anotações, docs, pagamento)', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}/aprovar': { post: { tags: ['Envios'], summary: 'Operador aprova', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}/solicitar-retificacao': { post: { tags: ['Envios'], summary: 'Operador solicita retificação', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}/rejeitar': { post: { tags: ['Envios'], summary: 'Operador rejeita', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}/marcar-pago': { post: { tags: ['Pagamentos'], summary: 'Admin marca como pago (TED estruturado)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}/encaminhar-sede': { post: { tags: ['Envios'], summary: 'Operador encaminha para FESF Sede', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}/versoes': { post: { tags: ['Envios'], summary: 'Fornecedor cria nova versão (retificação)', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/envios/{id}/documentos': { post: { tags: ['Documentos'], summary: 'Upload documento (multipart)', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/envios/{id}/documentos/{docId}/preview': { get: { tags: ['Documentos'], summary: 'Preview inline', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}/documentos/{docId}/download': { get: { tags: ['Documentos'], summary: 'Download', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/{id}/documentos/{docId}/anotacao': { post: { tags: ['Documentos'], summary: 'Anotar documento (verificado/duvida/problema)', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/envios/{id}/anotacoes': { post: { tags: ['Documentos'], summary: 'Anotar campo do formulário', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/envios/{id}/solicitar-reenvio': { post: { tags: ['Documentos'], summary: 'Operador pede reenvio de doc específico', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/envios/{id}/comentarios': { post: { tags: ['Envios'], summary: 'Adiciona comentário na thread', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/envios/bulk/aprovar': { post: { tags: ['Envios'], summary: 'Aprovação em lote', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/bulk/marcar-pago': { post: { tags: ['Pagamentos'], summary: 'Pagamento em lote', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/envios/protocolo/{protocolo}': { get: { tags: ['Cenário 2 · Link público'], summary: 'Consulta pública por protocolo (sem auth)', responses: { 200: { description: 'OK' }, 429: { description: 'Rate limit (30/min)' } } } },
    '/api/envios/protocolo/{protocolo}/recibo': { get: { tags: ['Cenário 2 · Link público'], summary: 'Recibo anônimo via protocolo', responses: { 200: { description: 'OK' } } } },
    '/api/envios/export.csv': { get: { tags: ['Envios'], summary: 'Export CSV dos envios', security: [{ BearerAuth: [] }], responses: { 200: { description: 'CSV' } } } },
    '/api/expectativas': {
      get: { tags: ['Cenário 3 · Pendências'], summary: 'Lista expectativas (escopo por papel)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } },
      post: { tags: ['Cenário 3 · Pendências'], summary: 'Cria expectativa com cadência opcional', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' }, 409: { description: 'Fornecedor inadimplente' } } },
    },
    '/api/expectativas/{id}/lembrete': { post: { tags: ['Cenário 3 · Pendências'], summary: 'Dispara lembrete manual', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/expectativas/{id}/cancelar': { post: { tags: ['Cenário 3 · Pendências'], summary: 'Cancela expectativa', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/expectativas/{id}/converter-manual': { post: { tags: ['Cenário 3 · Pendências'], summary: 'FESF assume e cria envio manual', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/expectativas/bulk/cancelar': { post: { tags: ['Cenário 3 · Pendências'], summary: 'Bulk cancel de pendências antigas', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/expectativas/escalonar': { post: { tags: ['Cenário 3 · Pendências'], summary: 'Força escalonamento agora (admin)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/links': { post: { tags: ['Cenário 2 · Link público'], summary: 'Operador gera link público', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/links/{token}': { get: { tags: ['Cenário 2 · Link público'], summary: 'Lookup do link (sem auth)', responses: { 200: { description: 'OK' } } } },
    '/api/links/{id}': { delete: { tags: ['Cenário 2 · Link público'], summary: 'Revoga link', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/fornecedores/cadastrar': { post: { tags: ['Fornecedores'], summary: 'Auto-cadastro público (com_portal)', responses: { 201: { description: 'OK · pendente aprovação' }, 429: { description: 'Rate limit (5/min)' } } } },
    '/api/fornecedores/externo': { post: { tags: ['Fornecedores'], summary: 'Operador cadastra fornecedor externo', security: [{ BearerAuth: [] }], responses: { 201: { description: 'OK' } } } },
    '/api/fornecedores/{id}/aprovar': { post: { tags: ['Fornecedores'], summary: 'Admin aprova cadastro', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/fornecedores/{id}/engajamento': { patch: { tags: ['Fornecedores'], summary: 'Marca status (ativo/inadimplente/inativo)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/notificacoes': { get: { tags: ['Admin'], summary: 'Lista notificações do usuário', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/notificacoes/ler-todas': { post: { tags: ['Admin'], summary: 'Marca todas como lidas', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/metricas': { get: { tags: ['Métricas'], summary: 'KPIs rede + SLA + time-series', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/auditoria/sistema': { get: { tags: ['Auditoria'], summary: 'Trilha sistêmica com filtros (desde, ate, q, usuario_id)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/auditoria': { get: { tags: ['Auditoria'], summary: 'Trilha de uma entidade específica', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/me': {
      get: { tags: ['Admin'], summary: 'Perfil do usuário logado', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } },
      patch: { tags: ['Admin'], summary: 'Atualiza próprio nome', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } },
    },
    '/api/me/senha': { post: { tags: ['Admin'], summary: 'Troca a própria senha', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } } },
    '/api/configuracoes': {
      get: { tags: ['Admin'], summary: 'Lê configurações (cadência, SLA, etc.)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } },
      put: { tags: ['Admin'], summary: 'Salva configurações', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' } } },
    },
    '/api/admin/backup': { get: { tags: ['Admin'], summary: 'Export JSON completo (DR)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'JSON download' } } } },
    '/api/admin/restore': { post: { tags: ['Admin'], summary: 'Re-importa backup com confirmacao=SUBSTITUIR_TUDO', security: [{ BearerAuth: [] }], responses: { 200: { description: 'OK' }, 400: { description: 'Confirmação inválida' } } } },
  },
};
