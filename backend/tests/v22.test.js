// =====================================================================
// V22: Config editavel, first-login onboarding, recibo anon por
//      protocolo, empty states padronizados
// =====================================================================
const BASE = 'http://localhost:3000';
let passed = 0; let failed = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passed++; }
  catch (e) { console.log(`  ✗ ${nome}\n    ${e.message}`); failed++; }
}
function assert(c, m='assert') { if (!c) throw new Error(m); }
async function req(method, path, { body, token } = {}) {
  const headers = {};
  let bodyOut;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; bodyOut = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: bodyOut });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
async function login(email) {
  const r = await req('POST', '/api/auth/login', { body: { email, senha: 'senha123' } });
  if (r.status !== 200) throw new Error('login: ' + r.text);
  return { token: r.json.token, usuario: r.json.usuario };
}

console.log('\n[V22 · Setup]');
let tokenAdmin, tokenOp, tokenForn, usuarioAdmin;
await test('logins', async () => {
  const a = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenAdmin = a.token; usuarioAdmin = a.usuario;
  tokenOp = (await login('carlos.souza@fesfsus.ba.gov.br')).token;
  tokenForn = (await login('contato@empresahosp.com.br')).token;
});

// ============================================
console.log('\n[V22 · Configuracoes editaveis]');

await test('GET /api/configuracoes retorna defaults', async () => {
  const r = await req('GET', '/api/configuracoes', { token: tokenAdmin });
  assert(r.status === 200);
  assert(r.json.configuracoes);
  assert(r.json.padrao);
  assert(r.json.padrao.cadencia_lembretes);
  assert(r.json.padrao.sla_dias_aprovacao);
});

await test('PUT /api/configuracoes grava cadencia personalizada', async () => {
  const r = await req('PUT', '/api/configuracoes', {
    token: tokenAdmin,
    body: { cadencia_lembretes: { antes: [7, 2], depois: [2, 5, 10] }, sla_dias_aprovacao: 8 }
  });
  assert(r.status === 200);
  assert(r.json.ok === true);
  const r2 = await req('GET', '/api/configuracoes', { token: tokenAdmin });
  assert(r2.json.configuracoes.cadencia_lembretes.antes[0] === 7);
  assert(r2.json.configuracoes.sla_dias_aprovacao === 8);
});

await test('PUT /api/configuracoes ignora chaves desconhecidas', async () => {
  const r = await req('PUT', '/api/configuracoes', {
    token: tokenAdmin, body: { chave_inexistente: 'oi', sla_dias_pagamento: 12 }
  });
  assert(r.status === 200);
  assert(r.json.gravadas === 1, 'apenas 1 chave valida foi gravada');
});

await test('operador NAO pode salvar configuracoes (403)', async () => {
  const r = await req('PUT', '/api/configuracoes', {
    token: tokenOp, body: { sla_dias_aprovacao: 1 }
  });
  assert(r.status === 403);
});

await test('operador PODE ler configuracoes', async () => {
  const r = await req('GET', '/api/configuracoes', { token: tokenOp });
  assert(r.status === 200);
});

// ============================================
console.log('\n[V22 · First-login (primeiro_acesso)]');

await test('login retorna primeiro_acesso na primeira vez', async () => {
  // O admin foi logado uma vez no setup. Vamos checar o seed real:
  // o teste anterior pode ter usado o usuario. Reset com login fresco:
  const r = await req('POST', '/api/auth/login', { body: { email: 'maria.andrade@fesfsus.ba.gov.br', senha: 'senha123' } });
  assert(r.status === 200);
  assert(typeof r.json.usuario.primeiro_acesso === 'boolean', 'usuario tem primeiro_acesso flag');
});

await test('POST /api/me/concluir-onboarding marca como FALSE', async () => {
  const r = await req('POST', '/api/me/concluir-onboarding', { token: tokenAdmin });
  assert(r.status === 200);
  // Re-login para ver flag atualizada
  const r2 = await req('POST', '/api/auth/login', { body: { email: 'maria.andrade@fesfsus.ba.gov.br', senha: 'senha123' } });
  assert(r2.json.usuario.primeiro_acesso === false);
});

// ============================================
console.log('\n[V22 · Recibo anonimo por protocolo]');

let protocoloPublico;
await test('cria envio e captura protocolo', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'V22-1' } });
  protocoloPublico = r.json.envio.protocolo;
});

await test('GET /api/envios/protocolo/:p/recibo (SEM token) retorna 200', async () => {
  const r = await req('GET', `/api/envios/protocolo/${encodeURIComponent(protocoloPublico)}/recibo`, {});
  assert(r.status === 200);
  assert(r.json.envio);
  assert(r.json.envio.protocolo === protocoloPublico);
  assert(Array.isArray(r.json.documentos));
  assert(Array.isArray(r.json.versoes));
  assert(Array.isArray(r.json.auditoria));
});

await test('protocolo inexistente retorna 404', async () => {
  const r = await req('GET', `/api/envios/protocolo/INEXISTENTE-XYZ/recibo`, {});
  assert(r.status === 404);
});

// ============================================
console.log('\n[V22 · UI]');

await test('admin-config.html tem inputs editaveis e salvarCadencia', async () => {
  const r = await fetch(`${BASE}/app/admin-config.html`);
  const t = await r.text();
  assert(t.includes('cad-antes-1'));
  assert(t.includes('salvarCadencia'));
  assert(t.includes('salvarSLA'));
  assert(t.includes('Salvar cadência'));
});

await test('login.html roteia primeiro_acesso para onboarding', async () => {
  const r = await fetch(`${BASE}/app/login.html`);
  const t = await r.text();
  assert(t.includes('primeiro_acesso'));
  assert(t.includes('onboarding.html?primeiro=1'));
});

await test('onboarding.html tem botão "Começar a usar" e concluirOnboarding', async () => {
  const r = await fetch(`${BASE}/app/onboarding.html`);
  const t = await r.text();
  assert(t.includes('Começar a usar'));
  assert(t.includes('concluirOnboarding'));
});

await test('recibo.html aceita modo anônimo via ?protocolo=', async () => {
  const r = await fetch(`${BASE}/app/recibo.html`);
  const t = await r.text();
  assert(t.includes('reciboPublico'));
  assert(t.includes('protocolo'));
});

await test('sucesso.html alterna entre id/protocolo no link de recibo', async () => {
  const r = await fetch(`${BASE}/app/sucesso.html`);
  const t = await r.text();
  assert(t.includes('temToken') || t.includes('fesf_token'));
  assert(t.includes('protocolo=') || t.includes('?protocolo='));
});

await test('style.css tem classe .empty-state padronizada', async () => {
  const r = await fetch(`${BASE}/app/style.css`);
  const t = await r.text();
  assert(t.includes('.empty-state'));
  assert(t.includes('.empty-state .icon'));
});

await test('painel.html usa empty-state nos links e na visao por unidade', async () => {
  const r = await fetch(`${BASE}/app/painel.html`);
  const t = await r.text();
  assert(t.includes('empty-state'));
  assert(t.includes('Nenhum link público gerado') || t.includes('Visão por unidade'));
});

console.log('\n========================================');
console.log(`V22: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
