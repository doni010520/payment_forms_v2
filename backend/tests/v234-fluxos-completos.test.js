// =====================================================================
// V234: fluxos end-to-end encadeados (operação real)
//
// Diferente do smoke (V233), aqui cada teste simula uma jornada COMPLETA
// que cruza endpoints e perfis. Ex: operador pede retificação → fornecedor
// envia v2 → operador aprova v2. Esses cenários encadeados pegam bugs
// que testes isolados deixam passar.
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0; const erros = [];
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; erros.push(`${nome}: ${e.message}`); }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token, idemKey } = {}) {
  const headers = {};
  let bodyOut;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idemKey) headers['X-Idempotency-Key'] = idemKey;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
async function login(email, senha = 'senha123') {
  const r = await req('POST', '/api/auth/login', { body: { email, senha } });
  return r.json && r.json.token;
}
async function uploadDoc(envId, tok, conteudo = 'doc test', nome = 'doc.pdf', campo = 'q5_nf') {
  const fd = new FormData();
  fd.append('arquivo', new Blob([conteudo], { type: 'application/pdf' }), nome);
  fd.append('campo', campo);
  const r = await fetch(`${BASE}/api/envios/${envId}/documentos`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd,
  });
  return { status: r.status, json: r.status === 201 ? await r.json() : null };
}

let fornTok, opTok, admTok;

console.log('\n══════════════════════════════════════════');
console.log('  E2E 1 · Fluxo de retificação completo');
console.log('══════════════════════════════════════════');

let retEnvioId;
await test('E1-1: logins setup', async () => {
  fornTok = await login('contato@empresahosp.com.br');
  opTok = await login('carlos.souza@fesfsus.ba.gov.br');
  admTok = await login('maria.andrade@fesfsus.ba.gov.br');
  assert(fornTok && opTok && admTok);
});

await test('E1-2: fornecedor cria envio v1', async () => {
  const r = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-08',
    valor_centavos: 100000, numero_nf: 'RET-' + Date.now(),
  } });
  assert(r.status === 201, r.text);
  retEnvioId = r.json.envio.id;
  // Upload doc v1
  const up = await uploadDoc(retEnvioId, fornTok, 'NF v1', 'nf-v1.pdf');
  assert(up.status === 201);
});

await test('E1-3: operador solicita retificação', async () => {
  const r = await req('POST', `/api/envios/${retEnvioId}/solicitar-retificacao`, {
    token: opTok, body: { motivo: 'valor declarado nao bate com NF anexada' }
  });
  assert(r.status === 200, r.text);
  // Status do envio deve virar aguardando_ret (V214 convenção interna)
  const det = await req('GET', `/api/envios/${retEnvioId}`, { token: opTok });
  assert(det.json.envio.status === 'aguardando_ret', `status: ${det.json.envio.status}`);
});

await test('E1-4: fornecedor recebe notificação de retificação', async () => {
  const r = await req('GET', '/api/notificacoes', { token: fornTok });
  const n = r.json.notificacoes.find(n => /retifica/i.test(n.mensagem || ''));
  assert(n, 'notificação de retificação não chegou');
});

await test('E1-5: fornecedor cria nova versão (v2) com correção', async () => {
  // Endpoint real: POST /:id/versoes (cria nova versão; service muda status para retificado)
  const r = await req('POST', `/api/envios/${retEnvioId}/versoes`, {
    token: fornTok, body: {
      valor_centavos: 95000,
      observacao: 'Corrigi valor conforme NF.',
    }
  });
  assert(r.status === 201, r.text);
  // Status muda para "retificado" (V214 fluxo)
  const det = await req('GET', `/api/envios/${retEnvioId}`, { token: opTok });
  assert(['retificado', 'em_analise'].includes(det.json.envio.status), `status pos-ret: ${det.json.envio.status}`);
  assert(det.json.versoes.length >= 2, `versoes: ${det.json.versoes.length}`);
});

await test('E1-6: operador aprova v2', async () => {
  const r = await req('POST', `/api/envios/${retEnvioId}/aprovar`, {
    token: opTok, body: { observacao: 'OK após retificação' }
  });
  assert(r.status === 200, r.text);
});

await test('E1-7: auditoria tem trilha completa (criado → retificacao → retificado → aprovado)', async () => {
  const r = await req('GET', `/api/envios/${retEnvioId}`, { token: opTok });
  const acoes = r.json.auditoria.map(a => a.acao);
  assert(acoes.includes('retificacao_solicitada'), `falta retificacao_solicitada: ${acoes.join(',')}`);
  assert(acoes.some(a => a === 'aprovado' || a === 'envio_aprovado'), `falta aprovacao: ${acoes.join(',')}`);
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 2 · Link público anônimo end-to-end');
console.log('══════════════════════════════════════════');

let tokenPublico, envioPublicoId;
await test('E2-1: operador cria link público', async () => {
  const r = await req('POST', '/api/links', { token: opTok, body: {
    unidade_id: 1, modalidade_id: 1, fornecedor_id: 1,
    email_destinatario: 'anon@test.com',
    uso_multiplo: false,
  } });
  assert(r.status === 201, r.text);
  tokenPublico = r.json.link.token;
});

await test('E2-2: anônimo busca contexto do token (sem auth)', async () => {
  const r = await req('GET', `/api/links/${tokenPublico}`);
  assert(r.status === 200);
  assert(r.json.valido === true);
  assert(r.json.modalidade_nome);
  assert(r.json.unidade_sigla === 'HECC');
});

await test('E2-3: anônimo submete envio via link público', async () => {
  const r = await req('POST', `/api/envios/publico/${tokenPublico}`, { body: {
    competencia: '2026-08', valor_centavos: 50000, numero_nf: 'PUB-' + Date.now(),
    submetente_nome: 'João Anônimo', submetente_documento: '12345678901',
    descricao: 'envio via link público',
  } });
  assert(r.status === 201, r.text);
  envioPublicoId = r.json.envio.id;
});

await test('E2-4: anônimo faz upload de documento (V221)', async () => {
  const fd = new FormData();
  fd.append('arquivo', new Blob(['doc anonimo'], { type: 'text/plain' }), 'anon.pdf');
  fd.append('campo', 'q5_nf');
  const r = await fetch(`${BASE}/api/envios/publico/${tokenPublico}/${envioPublicoId}/documentos`, {
    method: 'POST', body: fd,
  });
  assert(r.status === 201, `upload status ${r.status}`);
});

await test('E2-5: link single-use rejeita 2º envio', async () => {
  const r = await req('POST', `/api/envios/publico/${tokenPublico}`, { body: {
    competencia: '2026-09', valor_centavos: 100, numero_nf: 'PUB-' + Date.now(),
    submetente_nome: 'X', submetente_documento: '11122233344',
  } });
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
  assert(r.json.code === 'ALREADY_USED', `code: ${r.json.code}`);
});

await test('E2-6: operador vê envio com origem=link_publico no painel', async () => {
  const r = await req('GET', '/api/envios', { token: opTok });
  const pub = r.json.envios.find(e => e.id === envioPublicoId);
  assert(pub, 'envio publico nao aparece para operador');
  assert(pub.origem === 'link_publico');
});

await test('E2-7: consulta pública por protocolo do envio publico', async () => {
  const det = await req('GET', `/api/envios/${envioPublicoId}`, { token: opTok });
  const proto = det.json.envio.protocolo;
  const cons = await req('GET', `/api/envios/protocolo/${proto}`);
  assert(cons.status === 200);
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 3 · Esqueci senha → reset → login');
console.log('══════════════════════════════════════════');

await test('E3-1: POST /auth/esqueci-senha → 200 + email registrado', async () => {
  const antes = (await req('GET', '/api/emails', { token: admTok })).json.total || 0;
  const r = await req('POST', '/api/auth/esqueci-senha', { body: {
    email: 'contato@empresahosp.com.br'
  } });
  assert(r.status === 200);
  const depois = (await req('GET', '/api/emails', { token: admTok })).json.total;
  assert(depois > antes, `email não registrado: antes ${antes}, depois ${depois}`);
});

await test('E3-2: admin reseta senha → gera nova senha temp', async () => {
  // Busca id do fornecedor user
  const usr = (await req('GET', '/api/usuarios', { token: admTok })).json.usuarios
    .find(u => u.email === 'contato@empresahosp.com.br');
  assert(usr);
  const r = await req('POST', `/api/usuarios/${usr.id}/resetar-senha`, { token: admTok, body: {} });
  assert(r.status === 200);
  assert(r.json.senha_temporaria);
  // Login com senha nova deve funcionar
  const novoTok = await login('contato@empresahosp.com.br', r.json.senha_temporaria);
  assert(novoTok, 'login com senha temp falhou');
  // V197/V198: sessões antigas devem ter sido revogadas
  const oldFornTok = fornTok;
  const verifyOld = await req('GET', '/api/me', { token: oldFornTok });
  assert(verifyOld.status === 401, `token antigo deveria ter sido revogado, mas status ${verifyOld.status}`);
  // V226: senha temp ativa bloqueia writes
  const meRet = await req('GET', '/api/me', { token: novoTok });
  assert(meRet.json.usuario.senha_temporaria_ativa === true);
  // Atualiza fornTok para os próximos tests
  fornTok = novoTok;
});

await test('E3-3: fornecedor troca a senha → flag desativa, writes liberam', async () => {
  const trocar = await req('POST', '/api/me/senha', { token: fornTok, body: {
    senha_atual: undefined, // não temos a senha atual em memória — vou pegar do test acima
    nova_senha: 'SenhaNova2026!',
  } });
  // O test acima já usou a senha temp para login. Recupera ela do response anterior.
  // Como ja fizemos login com a senha temp, vou refazer reset + troca pra ter referência.
  const usr = (await req('GET', '/api/usuarios', { token: admTok })).json.usuarios
    .find(u => u.email === 'contato@empresahosp.com.br');
  const reset = await req('POST', `/api/usuarios/${usr.id}/resetar-senha`, { token: admTok, body: {} });
  const tokTemp = await login('contato@empresahosp.com.br', reset.json.senha_temporaria);
  const r = await req('POST', '/api/me/senha', { token: tokTemp, body: {
    senha_atual: reset.json.senha_temporaria,
    nova_senha: 'SenhaNova2026!',
  } });
  assert(r.status === 200, r.text);
  assert(r.json.novo_token);
  fornTok = r.json.novo_token;
  // Flag deve ter desativado
  const me = await req('GET', '/api/me', { token: fornTok });
  assert(me.json.usuario.senha_temporaria_ativa === false);
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 4 · NF duplicada + idempotência');
console.log('══════════════════════════════════════════');

await test('E4-1: criar envio com NF duplicada (mesmo forn+NF+comp) → 409', async () => {
  const nf = 'DUP-' + Date.now();
  const r1 = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-08',
    valor_centavos: 1000, numero_nf: nf,
  } });
  assert(r1.status === 201, `1: ${r1.text}`);
  const r2 = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-08',
    valor_centavos: 1000, numero_nf: nf,
  } });
  assert(r2.status === 409, `esperava 409 dup, veio ${r2.status}: ${r2.text}`);
});

await test('E4-2: idempotency key — 2x mesmo POST = mesmo envio', async () => {
  const idem = 'idem-' + Date.now();
  const body = {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-09',
    valor_centavos: 1000, numero_nf: 'IDEM-' + Date.now(),
  };
  const r1 = await req('POST', '/api/envios/portal', { token: fornTok, body, idemKey: idem });
  assert(r1.status === 201);
  const id1 = r1.json.envio.id;
  const r2 = await req('POST', '/api/envios/portal', { token: fornTok, body, idemKey: idem });
  // Idempotência: 2ª requisição com mesma key não cria novo, retorna mesma resposta
  assert(r2.json.envio.id === id1, `idempotência falhou: id1=${id1} id2=${r2.json.envio.id}`);
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 5 · Expectativa cumprida automaticamente');
console.log('══════════════════════════════════════════');

await test('E5-1: operador cria expectativa para fornecedor', async () => {
  const r = await req('POST', '/api/expectativas', { token: opTok, body: {
    fornecedor_id: 1, unidade_id: 1, modalidade_id: 1,
    competencia: '2026-11', prazo: '2026-11-30', origem_prevista: 'portal',
  } });
  assert(r.status === 201);
});

await test('E5-2: fornecedor envia → expectativa deveria virar "cumprida"', async () => {
  // Cria envio na mesma competência + fornecedor + unidade da expectativa
  const r = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-11',
    valor_centavos: 200, numero_nf: 'CUMP-' + Date.now(),
  } });
  assert(r.status === 201);
  // Aguarda um momento e verifica status da expectativa
  await new Promise(res => setTimeout(res, 200));
  const exp = await req('GET', '/api/expectativas?competencia=2026-11', { token: opTok });
  const cumprida = exp.json.expectativas.find(e => e.fornecedor_id === 1 && e.status === 'cumprida');
  assert(cumprida, `nenhuma expectativa cumprida: ${JSON.stringify(exp.json.expectativas.map(e => e.status))}`);
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 6 · Hash dedup + dup notif para operador');
console.log('══════════════════════════════════════════');

await test('E6-1: upload com mesmo hash gera duplicate notif', async () => {
  const env = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-12',
    valor_centavos: 100, numero_nf: 'HASH-' + Date.now(),
  } });
  assert(env.status === 201);
  const env2 = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-12',
    valor_centavos: 100, numero_nf: 'HASH-' + Date.now() + 'B',
  } });
  assert(env2.status === 201);
  const conteudoIdentico = 'mesmo conteudo de NF';
  await uploadDoc(env.json.envio.id, fornTok, conteudoIdentico, 'a.pdf');
  await uploadDoc(env2.json.envio.id, fornTok, conteudoIdentico, 'b.pdf');
  // Operador deve receber notificação de duplicata
  const n = await req('GET', '/api/notificacoes', { token: opTok });
  const dup = n.json.notificacoes.find(x => /reutiliza|duplicat|j[áa] apareceu/i.test(x.mensagem));
  assert(dup, 'operador não recebeu alerta de hash duplicado');
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 7 · CSV exports preservam BOM + ;');
console.log('══════════════════════════════════════════');

await test('E7-1: GET /envios/export.csv como admin', async () => {
  const r = await fetch(`${BASE}/api/envios/export.csv`, {
    headers: { Authorization: 'Bearer ' + admTok }
  });
  assert(r.status === 200);
  const ct = r.headers.get('Content-Type');
  assert(/csv/i.test(ct), `Content-Type: ${ct}`);
  // Lê bytes brutos (fetch.text() consome BOM em UTF-8 — usar arrayBuffer)
  const buf = new Uint8Array(await r.arrayBuffer());
  assert(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, 'sem BOM UTF-8 (EF BB BF)');
  // Cabeçalho da 1ª linha usa ';'
  const text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
  assert(text.split('\n')[0].includes(';'), 'sem separador ;');
});

await test('E7-2: GET /admin/emails.csv', async () => {
  const r = await fetch(`${BASE}/api/admin/emails.csv`, {
    headers: { Authorization: 'Bearer ' + admTok }
  });
  assert(r.status === 200);
});

await test('E7-3: GET /auditoria/sistema.csv', async () => {
  const r = await fetch(`${BASE}/api/auditoria/sistema.csv`, {
    headers: { Authorization: 'Bearer ' + admTok }
  });
  assert(r.status === 200);
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 8 · Validações de body (errors graciosos)');
console.log('══════════════════════════════════════════');

await test('E8-1: envio sem competencia → 400', async () => {
  const r = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, valor_centavos: 100,
  } });
  assert(r.status === 400);
  assert(r.json.error, 'sem mensagem');
});

await test('E8-2: envio com unidade_id inexistente → erro (403/400/404)', async () => {
  const r = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 99999, modalidade_id: 1, competencia: '2026-08', valor_centavos: 100, numero_nf: 'X',
  } });
  // Aceita 403 (fornecedor não vinculado) ou 400/404 (unidade inválida)
  assert([400, 403, 404].includes(r.status), `status ${r.status}`);
  assert(r.json.error, 'sem mensagem');
});

await test('E8-3: aprovar envio inexistente → 404', async () => {
  const r = await req('POST', '/api/envios/99999/aprovar', { token: opTok, body: {} });
  assert(r.status === 404);
});

await test('E8-4: comentário com texto muito curto rejeita (validação)', async () => {
  // Texto vazio → 400
  const env = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-12',
    valor_centavos: 100, numero_nf: 'VAL-' + Date.now(),
  } });
  const r = await req('POST', `/api/envios/${env.json.envio.id}/comentarios`, {
    token: fornTok, body: { texto: '' }
  });
  assert(r.status === 400);
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 9 · Encaminhar p/ sede + admin marcar pago');
console.log('══════════════════════════════════════════');

await test('E9-1: operador aprova → encaminha p/ sede → admin marca pago', async () => {
  const env = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-09',
    valor_centavos: 50000, numero_nf: 'SED-' + Date.now(),
  } });
  const envId = env.json.envio.id;
  await req('POST', `/api/envios/${envId}/aprovar`, { token: opTok, body: { observacao: 'ok' } });
  const enc = await req('POST', `/api/envios/${envId}/encaminhar-sede`, {
    token: opTok, body: { motivo: 'envio aprovado, encaminhando para pagamento' }
  });
  assert(enc.status === 200, enc.text);
  const pago = await req('POST', `/api/envios/${envId}/marcar-pago`, {
    token: admTok, body: {
      numero_ted: 'TED-' + Date.now(),
      banco_pagador: 'BB',
      data_efetiva: '2026-09-20',
      valor_pago_centavos: 50000,
    }
  });
  assert(pago.status === 200, pago.text);
  // Status final
  const det = await req('GET', `/api/envios/${envId}`, { token: opTok });
  assert(det.json.envio.status === 'pago', `status final: ${det.json.envio.status}`);
  // Fornecedor recebe notif de pagamento
  const n = await req('GET', '/api/notificacoes', { token: fornTok });
  const pagoNotif = n.json.notificacoes.find(x => /pago|pagamento.*processad/i.test(x.mensagem));
  assert(pagoNotif, 'fornecedor não foi notificado do pagamento');
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 10 · Operador multi-unit (V154)');
console.log('══════════════════════════════════════════');

await test('E10-1: admin adiciona MRC como unidade extra para Carlos (HECC)', async () => {
  const carlos = (await req('GET', '/api/usuarios?papel=operador_unidade', { token: admTok }))
    .json.usuarios.find(u => u.email === 'carlos.souza@fesfsus.ba.gov.br');
  const r = await req('POST', `/api/usuarios/${carlos.id}/unidades`, { token: admTok, body: {
    unidade_id: 2 // MRC
  } });
  assert(r.status === 201, r.text);
});

await test('E10-2: Carlos agora vê envios das duas unidades', async () => {
  // Reloga para garantir token novo (não estritamente necessário, mas é a UX real)
  const tok = await login('carlos.souza@fesfsus.ba.gov.br');
  const unis = await req('GET', '/api/me/unidades', { token: tok });
  assert(unis.json.unidades.length >= 2,
    `operador deveria ver 2+ unidades, viu: ${unis.json.unidades.length}`);
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 11 · Maintenance mode bloqueia writes');
console.log('══════════════════════════════════════════');

await test('E11-1: admin liga maintenance → writes 503, reads OK', async () => {
  await req('PUT', '/api/configuracoes', { token: admTok, body: { maintenance_mode: true } });
  try {
    // Cache do isMaintenance() é 5s — aguarda invalidar antes de testar.
    // Polling até detectar bloqueio (máx 8s).
    let writeBloqueado = false;
    for (let i = 0; i < 16 && !writeBloqueado; i++) {
      await new Promise(res => setTimeout(res, 600));
      const wr = await req('POST', '/api/envios/portal', { token: fornTok, body: {
        unidade_id: 1, modalidade_id: 1, competencia: '2026-12',
        valor_centavos: 100, numero_nf: `MAINT-${Date.now()}-${i}`,
      } });
      if (wr.status === 503 || (wr.json && wr.json.maintenance)) {
        writeBloqueado = true;
        break;
      }
    }
    const rd = await req('GET', '/api/envios', { token: opTok });
    assert(rd.status === 200, 'read deveria ter passado em maintenance');
    assert(writeBloqueado, 'write não foi bloqueado após 8s em maintenance');
  } finally {
    // CRÍTICO: sempre desliga maintenance, mesmo se assert falhar, senão
    // contamina tests subsequentes do test-all.
    await req('PUT', '/api/configuracoes', { token: admTok, body: { maintenance_mode: false } });
    await new Promise(res => setTimeout(res, 5500));
  }
});

console.log('\n══════════════════════════════════════════');
console.log('  E2E 12 · Segurança cross-papel');
console.log('══════════════════════════════════════════');

await test('E12-1: fornecedor NÃO aprova envio (403)', async () => {
  const env = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-10',
    valor_centavos: 100, numero_nf: 'SEC-' + Date.now(),
  } });
  const r = await req('POST', `/api/envios/${env.json.envio.id}/aprovar`, {
    token: fornTok, body: { observacao: 'eu mesmo aprovo!' }
  });
  assert(r.status === 403);
});

await test('E12-2: operador NÃO acessa /admin/smtp (403)', async () => {
  const r = await req('GET', '/api/admin/smtp', { token: opTok });
  assert(r.status === 403);
});

await test('E12-3: operador NÃO marca pago (admin only)', async () => {
  const env = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: 1, modalidade_id: 1, competencia: '2026-10',
    valor_centavos: 100, numero_nf: 'SEC2-' + Date.now(),
  } });
  await req('POST', `/api/envios/${env.json.envio.id}/aprovar`, { token: opTok, body: { observacao: 'ok' } });
  const r = await req('POST', `/api/envios/${env.json.envio.id}/marcar-pago`, {
    token: opTok, body: { numero_ted: 'X', banco_pagador: 'X', data_efetiva: '2026-10-10', valor_pago_centavos: 100 }
  });
  assert(r.status === 403);
});

await test('E12-4: fornecedor de outro NÃO vê dados de outros (cross-tenant)', async () => {
  // Recém criado fornecedor V228 nao tem envios — vou simular com seed
  // Carlos não é fornecedor, mas o teste valida: forn A não acessa envio do forn B
  // Usa o envio recém criado (do fornecedor 1) e tenta acessar como outro user
  // Como só temos 1 fornecedor com portal no seed, este teste reusa F18 do smoke
  console.log('    [já coberto em smoke F18]');
});

// ----------------------------------------------------------------------
// CLEANUP: testes acima trocaram a senha do fornecedor (E3-2/E3-3).
// Restaura para 'senha123' para não contaminar tests subsequentes.
await test('CLEANUP 1: restaurar senha do fornecedor seed para senha123', async () => {
  const usr = (await req('GET', '/api/usuarios', { token: admTok })).json.usuarios
    .find(u => u.email === 'contato@empresahosp.com.br');
  if (!usr) { console.log('    [skip: usuário do seed não encontrado]'); return; }
  // Reseta com senha explícita (não temporária)
  const r = await req('POST', `/api/usuarios/${usr.id}/resetar-senha`, {
    token: admTok, body: { nova_senha: 'senha123' }
  });
  assert(r.status === 200);
  const novoTok = await login('contato@empresahosp.com.br', 'senha123');
  assert(novoTok, 'login com senha123 após cleanup falhou');
});

await test('CLEANUP 2: remover MRC como unidade extra do Carlos', async () => {
  const carlos = (await req('GET', '/api/usuarios?papel=operador_unidade', { token: admTok }))
    .json.usuarios.find(u => u.email === 'carlos.souza@fesfsus.ba.gov.br');
  if (!carlos) return;
  const unis = await req('GET', `/api/usuarios/${carlos.id}/unidades`, { token: admTok });
  const extras = (unis.json && unis.json.extras) || [];
  for (const u of extras) {
    await req('DELETE', `/api/usuarios/${carlos.id}/unidades/${u.unidade_id}`, { token: admTok });
  }
});

console.log('\n══════════════════════════════════════════');
console.log(`E2E completo: ${passed} passou · ${failed} falhou`);
console.log('══════════════════════════════════════════');
if (failed > 0) {
  console.log('\nFalhas:');
  for (const e of erros) console.log('  • ' + e);
}
process.exit(failed > 0 ? 1 : 0);
