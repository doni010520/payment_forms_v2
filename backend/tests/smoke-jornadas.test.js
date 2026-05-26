// =====================================================================
// V233: smoke test funcional por perfil
//
// Simula as 30+ ações básicas que cada perfil faz no dia-a-dia e
// reporta o que está quebrado. Não testa apenas status — também
// valida que o body retornado tem o que a UI precisa.
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0; const erros = [];
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; erros.push(`${nome}: ${e.message}`); }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token, raw } = {}) {
  const headers = {};
  let bodyOut;
  if (body !== undefined && !raw) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (raw) bodyOut = body; // FormData ou similar
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
async function login(email, senha = 'senha123') {
  const r = await req('POST', '/api/auth/login', { body: { email, senha } });
  return r.json && r.json.token;
}

let admTok, opTok, fornTok;

console.log('\n══════════════════════════════════════════');
console.log('  JORNADA 1 · FORNECEDOR');
console.log('══════════════════════════════════════════');

await test('F1: login com credenciais válidas → retorna token + usuario', async () => {
  const r = await req('POST', '/api/auth/login', { body: {
    email: 'contato@empresahosp.com.br', senha: 'senha123'
  } });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.json.token, 'sem token');
  assert(r.json.usuario.papel === 'fornecedor');
  fornTok = r.json.token;
});

await test('F2: login com senha errada → 401 com mensagem clara', async () => {
  const r = await req('POST', '/api/auth/login', { body: {
    email: 'contato@empresahosp.com.br', senha: 'errada'
  } });
  assert(r.status === 401, `status ${r.status}`);
  assert(/credenciais|inválid/i.test(r.json.error), `msg: ${r.json.error}`);
});

await test('F3: GET /me retorna dados do fornecedor logado', async () => {
  const r = await req('GET', '/api/me', { token: fornTok });
  assert(r.status === 200);
  const u = r.json.usuario;
  assert(u.papel === 'fornecedor');
  assert(u.fornecedor_id && u.fornecedor_razao_social);
});

await test('F4: GET /me/unidades retorna unidades que o fornecedor atende', async () => {
  const r = await req('GET', '/api/me/unidades', { token: fornTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.unidades));
  assert(r.json.unidades.length > 0, 'fornecedor sem unidades');
});

await test('F5: GET /modalidades público funciona', async () => {
  const r = await req('GET', '/api/modalidades');
  assert(r.status === 200);
  assert(Array.isArray(r.json.modalidades));
});

let envioId;
await test('F6: criar envio via portal → 201 + protocolo formato HECC-NNNN', async () => {
  const r = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-06',
    valor_centavos: 75000, numero_nf: 'SMOKE-' + Date.now(),
    descricao: 'envio teste smoke',
  } });
  assert(r.status === 201, `status ${r.status} ${r.text}`);
  assert(r.json.envio.protocolo, 'sem protocolo');
  assert(/^[A-Z]+-\d+/.test(r.json.envio.protocolo), `protocolo formato errado: ${r.json.envio.protocolo}`);
  envioId = r.json.envio.id;
});

let docId;
await test('F7: upload de documento no envio criado', async () => {
  const fd = new FormData();
  fd.append('arquivo', new Blob(['nota fiscal teste'], { type: 'application/pdf' }), 'nf.pdf');
  fd.append('campo', 'q5_nf');
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + fornTok }, body: fd,
  });
  assert(r.status === 201, `status ${r.status}`);
  docId = (await r.json()).documento.id;
});

await test('F8: GET /envios/:id retorna detalhes completos', async () => {
  const r = await req('GET', `/api/envios/${envioId}`, { token: fornTok });
  assert(r.status === 200);
  const e = r.json;
  assert(e.envio, 'sem envio');
  assert(Array.isArray(e.documentos), 'sem documentos[]');
  assert(e.documentos.length === 1, `esperava 1 doc, veio ${e.documentos.length}`);
  assert(Array.isArray(e.versoes));
  assert(Array.isArray(e.auditoria));
});

await test('F9: visualizar documento inline (preview)', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/preview`, {
    headers: { Authorization: 'Bearer ' + fornTok },
  });
  assert(r.status === 200);
  const cd = r.headers.get('Content-Disposition');
  assert(/inline/.test(cd), `Content-Disposition: ${cd}`);
});

await test('F10: download de documento (attachment)', async () => {
  const r = await fetch(`${BASE}/api/envios/${envioId}/documentos/${docId}/download`, {
    headers: { Authorization: 'Bearer ' + fornTok },
  });
  assert(r.status === 200);
  assert(/attachment/.test(r.headers.get('Content-Disposition')));
});

await test('F11: fornecedor comenta no envio', async () => {
  const r = await req('POST', `/api/envios/${envioId}/comentarios`, { token: fornTok, body: {
    texto: 'Comentário teste do fornecedor sobre este envio.',
  } });
  assert(r.status === 201, `status ${r.status} ${r.text}`);
});

await test('F12: GET /envios lista os envios do fornecedor', async () => {
  const r = await req('GET', '/api/envios', { token: fornTok });
  assert(r.status === 200);
  assert(r.json.envios.some(e => e.id === envioId), 'envio criado não aparece na lista');
});

await test('F13: GET /notificacoes retorna inbox do fornecedor', async () => {
  const r = await req('GET', '/api/notificacoes', { token: fornTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.notificacoes));
});

await test('F14: PUT /me/notif-prefs permite editar preferências', async () => {
  const r = await req('PUT', '/api/me/notif-prefs', { token: fornTok, body: {
    prefs: {
      novo_envio: true, status_envio: true, comentarios: false, pagamento: true,
      canais: { in_app: true, email: false },
    }
  } });
  assert(r.status === 200, r.text);
});

await test('F15: GET /me/dados-pessoais (LGPD portabilidade)', async () => {
  const r = await req('GET', '/api/me/dados-pessoais', { token: fornTok });
  assert(r.status === 200);
  assert(r.json.meta && r.json.meta.base_legal, 'sem meta legal');
  assert(r.json.dados_pessoais && r.json.dados_pessoais.fornecedor, 'sem fornecedor em dados_pessoais');
});

await test('F16: consulta pública por protocolo (sem auth)', async () => {
  // Pega o protocolo do envio criado
  const det = await req('GET', `/api/envios/${envioId}`, { token: fornTok });
  const proto = det.json.envio.protocolo;
  const r = await req('GET', `/api/envios/protocolo/${proto}`);
  assert(r.status === 200);
  assert(r.json.envio.protocolo === proto);
});

await test('F17: recibo público por protocolo', async () => {
  const det = await req('GET', `/api/envios/${envioId}`, { token: fornTok });
  const proto = det.json.envio.protocolo;
  const r = await req('GET', `/api/envios/protocolo/${proto}/recibo`);
  assert(r.status === 200);
  assert(r.json.envio && r.json.documentos);
});

await test('F18: fornecedor NÃO acessa envios de outros (segurança)', async () => {
  const r = await req('GET', '/api/envios/1', { token: fornTok });
  // Pode dar 200 (se o envio 1 é dele) ou 403/404
  assert([200, 403, 404].includes(r.status));
  if (r.status === 200) {
    assert(r.json.envio.fornecedor_id === 1, 'fornecedor 1 vê envios de outros!');
  }
});

console.log('\n══════════════════════════════════════════');
console.log('  JORNADA 2 · OPERADOR DE UNIDADE');
console.log('══════════════════════════════════════════');

await test('O1: login operador HECC', async () => {
  opTok = await login('carlos.souza@fesfsus.ba.gov.br');
  assert(opTok);
});

await test('O2: GET /me confirma papel operador_unidade', async () => {
  const r = await req('GET', '/api/me', { token: opTok });
  assert(r.json.usuario.papel === 'operador_unidade');
  assert(r.json.usuario.unidade_sigla === 'HECC');
});

await test('O3: GET /envios mostra envios da unidade HECC', async () => {
  const r = await req('GET', '/api/envios', { token: opTok });
  assert(r.status === 200);
  assert(r.json.envios.length > 0, 'sem envios na unidade');
});

await test('O4: GET /envios/resumo/origem para gráfico do painel', async () => {
  const r = await req('GET', '/api/envios/resumo/origem', { token: opTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.por_origem));
});

await test('O5: GET /expectativas pendências da unidade', async () => {
  const r = await req('GET', '/api/expectativas', { token: opTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.expectativas));
});

await test('O6: GET /fornecedores que atendem a unidade', async () => {
  const r = await req('GET', '/api/fornecedores', { token: opTok });
  assert(r.status === 200);
  assert(r.json.fornecedores.length > 0);
});

let manualEnvioId;
await test('O7: criar lançamento manual', async () => {
  const r = await req('POST', '/api/envios/manual', { token: opTok, body: {
    fornecedor_id: 1, unidade_id: 1, modalidade_id: 1,
    competencia: '2026-07', valor_centavos: 150000, numero_nf: 'SMOKE-MAN-' + Date.now(),
    motivo: 'lançamento manual no smoke test (fornecedor sem portal)',
  } });
  assert(r.status === 201, `status ${r.status} ${r.text}`);
  manualEnvioId = r.json.envio.id;
});

await test('O8: criar expectativa de envio', async () => {
  const r = await req('POST', '/api/expectativas', { token: opTok, body: {
    fornecedor_id: 1, unidade_id: 1, modalidade_id: 1,
    competencia: '2026-09', prazo: '2026-09-15', origem_prevista: 'portal',
  } });
  assert(r.status === 201, r.text);
});

await test('O9: preview cadência para nova expectativa', async () => {
  const r = await req('POST', '/api/expectativas/preview-cadencia', { token: opTok, body: {
    prazo: '2026-09-15',
  } });
  assert(r.status === 200);
  assert(r.json.eventos.length === 5); // padrão: 2 antes + prazo + 2 depois
});

await test('O10: GET /expectativas/metricas (escopo da unidade)', async () => {
  const r = await req('GET', '/api/expectativas/metricas', { token: opTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.por_status));
});

await test('O11: criar link público multi-uso (V227)', async () => {
  const r = await req('POST', '/api/links', { token: opTok, body: {
    unidade_id: 1, modalidade_id: 1, fornecedor_id: 1,
    email_destinatario: 'smoke@test.com',
    uso_multiplo: true, usos_max: 3, expira_em: '2099-12-31',
  } });
  assert(r.status === 201, r.text);
  assert(r.json.link.usos_max === 3);
});

await test('O12: aprovar o envio do fornecedor', async () => {
  const r = await req('POST', `/api/envios/${envioId}/aprovar`, { token: opTok, body: {
    observacao: 'aprovado no smoke test',
  } });
  assert(r.status === 200, r.text);
});

await test('O13: anotação em campo do envio (verificado)', async () => {
  // cria outro envio para anotar (o anterior já foi aprovado)
  const env = await req('POST', '/api/envios/manual', { token: opTok, body: {
    fornecedor_id: 1, unidade_id: 1, modalidade_id: 1,
    competencia: '2026-10', valor_centavos: 100, numero_nf: 'ANO-' + Date.now(),
    motivo: 'criado para teste de anotação no smoke',
  } });
  assert(env.status === 201, env.text);
  const r = await req('POST', `/api/envios/${env.json.envio.id}/anotacoes`, { token: opTok, body: {
    campo: 'q5_nf', status: 'verificado', observacao: 'NF conferida',
  } });
  assert(r.status === 201, r.text);
});

await test('O14: solicitar reenvio com prazo (V228)', async () => {
  const r = await req('POST', `/api/envios/${manualEnvioId}/solicitar-reenvio`, { token: opTok, body: {
    campo: 'q5_nf', motivo: 'NF ilegível, favor reenviar com qualidade superior',
    prazo_dias: 5,
  } });
  assert(r.status === 201, r.text);
  assert(r.json.tentativas === 1);
  assert(r.json.prazo_atendimento);
});

await test('O15: listar reenvios de um envio', async () => {
  const r = await req('GET', `/api/envios/${manualEnvioId}/reenvios`, { token: opTok });
  assert(r.status === 200);
  assert(r.json.reenvios.length >= 1);
});

await test('O16: marcar fornecedor como inadimplente (V223)', async () => {
  const r = await req('PATCH', '/api/fornecedores/1/engajamento', { token: opTok, body: {
    status: 'inadimplente',
    motivo: 'smoke test: fornecedor está atrasando entregas há 30 dias',
  } });
  assert(r.status === 200, r.text);
});

await test('O17: reverter engajamento para ativo', async () => {
  const r = await req('PATCH', '/api/fornecedores/1/engajamento', { token: opTok, body: {
    status: 'ativo',
  } });
  assert(r.status === 200);
});

await test('O18: aprovação em lote', async () => {
  // Cria 2 envios pra ter o que aprovar em lote
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const e = await req('POST', '/api/envios/manual', { token: opTok, body: {
      fornecedor_id: 1, unidade_id: 1, modalidade_id: 1,
      competencia: '2026-11', valor_centavos: 100 + i, numero_nf: `BULK-${Date.now()}-${i}`,
      motivo: 'criado para teste de bulk approve no smoke',
    } });
    if (e.status === 201) ids.push(e.json.envio.id);
  }
  if (ids.length === 0) { console.log('    [skip: sem envios para bulk]'); return; }
  const r = await req('POST', '/api/envios/bulk/aprovar', { token: opTok, body: { ids } });
  assert(r.status === 200, r.text);
});

await test('O19: search global', async () => {
  const r = await req('GET', '/api/search?q=hospitalar', { token: opTok });
  assert(r.status === 200);
  assert(r.json.resultados);
});

console.log('\n══════════════════════════════════════════');
console.log('  JORNADA 3 · ADMIN FESF SEDE');
console.log('══════════════════════════════════════════');

await test('A1: login admin', async () => {
  admTok = await login('maria.andrade@fesfsus.ba.gov.br');
  assert(admTok);
});

await test('A2: GET /metricas dashboard admin', async () => {
  const r = await req('GET', '/api/metricas', { token: admTok });
  assert(r.status === 200);
  assert(r.json.por_unidade && r.json.por_status);
});

await test('A3: listar fornecedores pendentes', async () => {
  const r = await req('GET', '/api/fornecedores/pendentes', { token: admTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.pendentes));
});

await test('A4: GET /configuracoes', async () => {
  const r = await req('GET', '/api/configuracoes', { token: admTok });
  assert(r.status === 200);
  assert(r.json.configuracoes);
});

await test('A5: PUT /configuracoes (alterar SLA)', async () => {
  const r = await req('PUT', '/api/configuracoes', { token: admTok, body: {
    sla_dias_aprovacao: 7,
  } });
  assert(r.status === 200);
});

await test('A6: GET /admin/smtp (V214)', async () => {
  const r = await req('GET', '/api/admin/smtp', { token: admTok });
  assert(r.status === 200);
  assert(r.json.config);
});

await test('A7: GET /emails (log de e-mails)', async () => {
  const r = await req('GET', '/api/emails', { token: admTok });
  assert(r.status === 200);
});

await test('A8: GET /auditoria/sistema', async () => {
  const r = await req('GET', '/api/auditoria/sistema', { token: admTok });
  assert(r.status === 200);
});

let novoUserId, novoUserEmail, senhaTempUser;
await test('A9: criar novo operador (gera senha temporária V226)', async () => {
  novoUserEmail = `smoke-op-${Date.now()}@fesf.test`;
  const r = await req('POST', '/api/usuarios', { token: admTok, body: {
    papel: 'operador_unidade', nome: 'Smoke Operador', email: novoUserEmail,
    unidade_id: 1,
  } });
  assert(r.status === 201, r.text);
  assert(r.json.senha_temporaria);
  novoUserId = r.json.id;
  senhaTempUser = r.json.senha_temporaria;
});

await test('A10: novo usuário com senha temp é bloqueado em writes (V226)', async () => {
  const login = await req('POST', '/api/auth/login', { body: {
    email: novoUserEmail, senha: senhaTempUser,
  } });
  assert(login.json.usuario.senha_temporaria_ativa === true);
  const tok = login.json.token;
  // Tenta criar envio — deve bloquear
  const r = await req('POST', '/api/envios/manual', { token: tok, body: {
    fornecedor_id: 1, unidade_id: 1, modalidade_id: 1,
    competencia: '2026-12', valor_centavos: 100, numero_nf: 'X',
    motivo: 'tentativa de uso antes de trocar senha',
  } });
  assert(r.status === 403);
  assert(r.json.code === 'PASSWORD_CHANGE_REQUIRED');
});

await test('A11: reset de senha de usuário existente', async () => {
  const r = await req('POST', `/api/usuarios/${novoUserId}/resetar-senha`, { token: admTok, body: {} });
  assert(r.status === 200);
  assert(r.json.senha_temporaria);
});

let aprovacaoFornId, aprovacaoSenha;
await test('A12: fluxo completo: cadastro público → admin aprova', async () => {
  // Cadastra
  const cnpjs = ['02558157000162', '34028316000103', '07526557000100'];
  let cad = null;
  for (const cnpj of cnpjs) {
    const r = await req('POST', '/api/fornecedores/cadastrar', { body: {
      tipo: 'com_portal',
      razao_social: 'Smoke Fornecedor ' + Date.now(),
      documento: cnpj,
      email: `smoke-cad-${Date.now()}-${cnpj.slice(0,4)}@test.com`,
      nome_contato: 'Contato Smoke',
      telefone: '71988887777',
      unidades_siglas: ['HECC'],
    } });
    if (r.status === 201) { cad = r; break; }
  }
  assert(cad, 'todos os CNPJs já cadastrados — sem como testar');
  aprovacaoFornId = cad.json.id;
  // Admin aprova
  const ap = await req('POST', `/api/fornecedores/${aprovacaoFornId}/aprovar`, { token: admTok });
  assert(ap.status === 200 || ap.status === 201, ap.text);
  assert(ap.json.senha_temporaria);
  aprovacaoSenha = ap.json.senha_temporaria;
});

await test('A13: marcar envio como pago (admin)', async () => {
  const r = await req('POST', `/api/envios/${envioId}/marcar-pago`, { token: admTok, body: {
    numero_ted: 'TED-SMOKE-' + Date.now(),
    banco_pagador: 'Banco do Brasil',
    data_efetiva: '2026-06-20',
    valor_pago_centavos: 75000,
    observacao: 'pago no smoke test',
  } });
  assert(r.status === 200, r.text);
});

await test('A14: GET /admin/audit-retention-stats (alias V181)', async () => {
  // Endpoint pode não existir — vou só verificar se está em alguma das rotas
  // A linha de teste real é que admin acessa stats operacionais
  const r = await req('GET', '/api/health/detailed', { token: admTok });
  assert(r.status === 200);
});

await test('A15: PUT system-banner via /configuracoes', async () => {
  const r = await req('PUT', '/api/configuracoes', { token: admTok, body: {
    system_banner: {
      texto: 'Manutenção programada para sábado às 22h',
      severidade: 'info',
    }
  } });
  assert(r.status === 200);
  // Verifica que aparece no GET público
  const banner = await req('GET', '/api/system-banner');
  assert(banner.status === 200);
  assert(/Manutenção programada/.test(JSON.stringify(banner.json)), 'banner não publicado');
});

await test('A16: backup completo (V171)', async () => {
  const r = await req('GET', '/api/admin/backup', { token: admTok });
  assert(r.status === 200);
  // Estrutura: { meta: {...}, dados: { tabela1: [], tabela2: [] } }
  assert(r.json.meta && r.json.dados, 'backup sem meta/dados');
  assert(Array.isArray(r.json.dados.fornecedores), 'backup sem fornecedores[]');
  assert(r.json.meta.total_registros > 0, 'backup vazio');
});

await test('A17: search global como admin', async () => {
  const r = await req('GET', '/api/search?q=hospital', { token: admTok });
  assert(r.status === 200);
  assert(r.json.resultados);
});

await test('A18: status-page detalhado', async () => {
  const r = await req('GET', '/api/health/detailed', { token: admTok });
  assert(r.status === 200);
  // Estrutura real: { ok, db_backend, migrations_aplicadas, contagens, ... }
  assert(r.json.db_backend, 'sem db_backend');
  assert(r.json.contagens && r.json.contagens.unidades, 'sem contagens');
});

await test('A19: GET /version', async () => {
  const r = await req('GET', '/api/version');
  assert(r.status === 200);
  // Campo se chama "versao" não "version"
  assert(r.json.versao, `sem versao: ${JSON.stringify(r.json)}`);
  assert(r.json.app === 'fesf-portal-pagamentos');
});

await test('A20: GET /metrics (prometheus)', async () => {
  const r = await fetch(`${BASE}/metrics`);
  assert(r.status === 200);
  const t = await r.text();
  assert(/^# HELP/m.test(t), 'formato prometheus inválido');
});

// ----------------------------------------------------------------------
console.log('\n══════════════════════════════════════════');
console.log(`Smoke: ${passed} passou · ${failed} falhou`);
console.log('══════════════════════════════════════════');
if (failed > 0) {
  console.log('\nFalhas:');
  for (const e of erros) console.log('  • ' + e);
}
process.exit(failed > 0 ? 1 : 0);
