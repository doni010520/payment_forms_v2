// =====================================================================
// Modo manutenção — writes bloqueados, reads OK
// =====================================================================
import { setTimeout as wait } from 'node:timers/promises';

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
  return r.json.token;
}

console.log('\n[Maintenance mode]');

let tokenAdmin, tokenForn;
await test('logins', async () => {
  tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br');
  tokenForn = await login('contato@empresahosp.com.br');
});

await test('estado inicial: maintenance OFF', async () => {
  const r = await fetch(`${BASE}/api/health/detailed`);
  const j = await r.json();
  assert(j.maintenance_mode === false, 'estado inicial: OFF');
});

await test('writes funcionam normalmente quando OFF', async () => {
  const r = await req('POST', '/api/me/concluir-onboarding', { token: tokenForn });
  assert(r.status === 200);
});

await test('admin LIGA modo manutenção', async () => {
  const r = await req('PUT', '/api/configuracoes', { token: tokenAdmin, body: { maintenance_mode: true } });
  assert(r.status === 200);
  // espera cache invalidar (5s)
  await wait(5500);
});

await test('health/detailed reflete maintenance_mode=true', async () => {
  const r = await fetch(`${BASE}/api/health/detailed`);
  const j = await r.json();
  assert(j.maintenance_mode === true, 'health reflete novo estado');
});

await test('reads (GET) continuam funcionando em manutenção', async () => {
  const r = await req('GET', '/api/envios', { token: tokenForn });
  assert(r.status === 200, 'GET funciona: ' + r.status);
});

await test('writes (POST) retornam 503 em manutenção', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const r = await req('POST', '/api/envios/portal', { token: tokenForn,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-12', valor_centavos: 100, numero_nf: 'MAINT' } });
  assert(r.status === 503, 'POST deveria 503, foi ' + r.status);
  assert(r.json.maintenance === true);
  assert(r.json.error.includes('manutenção'));
});

await test('login ainda funciona em manutenção (whitelist)', async () => {
  const r = await req('POST', '/api/auth/login', { body: { email: 'contato@empresahosp.com.br', senha: 'senha123' } });
  assert(r.status === 200, 'login não pode ser bloqueado, admin precisa entrar');
});

await test('configurações POST/PUT ainda funcionam (whitelist p/ desligar)', async () => {
  const r = await req('PUT', '/api/configuracoes', { token: tokenAdmin, body: { maintenance_mode: false } });
  assert(r.status === 200, 'admin precisa conseguir desligar manutenção');
  await wait(5500);
});

await test('apos desligar, writes voltam', async () => {
  const r = await req('POST', '/api/me/concluir-onboarding', { token: tokenForn });
  assert(r.status === 200);
});

console.log('\n========================================');
console.log(`Maintenance: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
