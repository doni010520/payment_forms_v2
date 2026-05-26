// =====================================================================
// System banner — aviso global do admin
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

console.log('\n[System banner]');

let tokenAdmin;
await test('login admin', async () => { tokenAdmin = await login('maria.andrade@fesfsus.ba.gov.br'); });

await test('GET /api/system-banner (público) retorna null inicialmente', async () => {
  const r = await fetch(`${BASE}/api/system-banner`);
  assert(r.status === 200);
  const j = await r.json();
  assert(j.banner === null, 'sem banner: ' + JSON.stringify(j));
});

await test('admin posta banner via configuracoes', async () => {
  const r = await req('PUT', '/api/configuracoes', { token: tokenAdmin,
    body: { system_banner: { texto: 'Manutenção amanhã 22h', severidade: 'warn', expira_em: '2099-01-01T00:00:00Z' } } });
  assert(r.status === 200);
});

await test('GET /api/system-banner agora retorna o banner', async () => {
  const r = await fetch(`${BASE}/api/system-banner`);
  const j = await r.json();
  assert(j.banner && j.banner.texto === 'Manutenção amanhã 22h');
  assert(j.banner.severidade === 'warn');
});

await test('endpoint é PÚBLICO (sem auth)', async () => {
  // Crítico: login.html precisa mostrar o banner antes do usuário autenticar
  const r = await fetch(`${BASE}/api/system-banner`); // sem Authorization
  assert(r.status === 200);
});

await test('banner expirado é filtrado automaticamente', async () => {
  await req('PUT', '/api/configuracoes', { token: tokenAdmin,
    body: { system_banner: { texto: 'Anuncio antigo', severidade: 'info', expira_em: '2020-01-01T00:00:00Z' } } });
  const r = await fetch(`${BASE}/api/system-banner`);
  const j = await r.json();
  assert(j.banner === null, 'banner expirado não deve aparecer: ' + JSON.stringify(j));
});

await test('banner sem texto retorna null', async () => {
  await req('PUT', '/api/configuracoes', { token: tokenAdmin,
    body: { system_banner: { texto: '', severidade: 'info' } } });
  const r = await fetch(`${BASE}/api/system-banner`);
  const j = await r.json();
  assert(j.banner === null);
});

await test('admin limpa banner (set null)', async () => {
  await req('PUT', '/api/configuracoes', { token: tokenAdmin, body: { system_banner: null } });
  const r = await fetch(`${BASE}/api/system-banner`);
  assert((await r.json()).banner === null);
});

await test('api.js tem código de banner auto-injetado', async () => {
  const r = await fetch(`${BASE}/app/api.js`);
  const t = await r.text();
  assert(t.includes('injetarBanner') || t.includes('system-banner'));
  assert(t.includes('Dispensar'));
});

console.log('\n========================================');
console.log(`Banner: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
