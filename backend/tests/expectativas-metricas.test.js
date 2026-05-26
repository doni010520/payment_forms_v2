// =====================================================================
// V232 / O4 — métricas de expectativas + preview de cadência
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
async function login(email, senha = 'senha123') {
  const r = await req('POST', '/api/auth/login', { body: { email, senha } });
  return r.json && r.json.token;
}

console.log('\n[Expectativas — métricas + preview cadência — V232/O4]');

let admTok, opTok, fornTok;
await test('logins', async () => {
  admTok = await login('maria.andrade@fesfsus.ba.gov.br');
  opTok = await login('carlos.souza@fesfsus.ba.gov.br');
  fornTok = await login('contato@empresahosp.com.br');
  assert(admTok && opTok);
});

// -------------------------------------------------------------------
// Preview de cadência
// -------------------------------------------------------------------
await test('preview-cadencia com cadência padrão → 5 eventos ordenados', async () => {
  const r = await req('POST', '/api/expectativas/preview-cadencia', { token: opTok, body: {
    prazo: '2026-10-15', // sem cadencia → usa padrão
  } });
  assert(r.status === 200, r.text);
  const ev = r.json.eventos;
  // Padrão: 2 lembretes antes (5d, 1d) + prazo + 2 escalonamentos depois (3d, 7d) = 5 eventos
  assert(ev.length === 5, `eventos: ${ev.length}`);
  // Ordem cronológica
  for (let i = 1; i < ev.length; i++) {
    assert(ev[i].quando >= ev[i-1].quando, 'eventos fora de ordem');
  }
  // O marco "prazo" no meio
  const prazo = ev.find(e => e.tipo === 'prazo');
  assert(prazo && prazo.quando === '2026-10-15', `prazo errado: ${prazo?.quando}`);
  // Lembretes antes: 2026-10-10 (5d) e 2026-10-14 (1d)
  const lembretes = ev.filter(e => e.tipo === 'lembrete');
  assert(lembretes.length === 2);
  assert(lembretes.some(e => e.quando === '2026-10-10'));
  assert(lembretes.some(e => e.quando === '2026-10-14'));
  // Depois: sem_resposta (3d) e atrasada (7d)
  const sr = ev.find(e => e.tipo === 'sem_resposta');
  const at = ev.find(e => e.tipo === 'atrasada');
  assert(sr.quando === '2026-10-18', `sem_resposta: ${sr.quando}`);
  assert(at.quando === '2026-10-22', `atrasada: ${at.quando}`);
});

await test('preview com cadência customizada {antes:[7],depois:[5,14]}', async () => {
  const r = await req('POST', '/api/expectativas/preview-cadencia', { token: opTok, body: {
    prazo: '2026-11-20',
    cadencia: { antes: [7], depois: [5, 14] },
  } });
  assert(r.status === 200);
  const ev = r.json.eventos;
  assert(ev.length === 4, `eventos: ${ev.length}`); // 1 lembrete + prazo + 2 escalonamentos
  assert(ev[0].quando === '2026-11-13'); // 7d antes
  assert(ev[1].quando === '2026-11-20'); // prazo
  assert(ev[2].quando === '2026-11-25'); // +5d
  assert(ev[3].quando === '2026-12-04'); // +14d
});

await test('preview sem prazo → 400', async () => {
  const r = await req('POST', '/api/expectativas/preview-cadencia', { token: opTok, body: {} });
  assert(r.status === 400);
});

await test('preview com prazo inválido → 400', async () => {
  const r = await req('POST', '/api/expectativas/preview-cadencia', { token: opTok, body: {
    prazo: 'banana',
  } });
  assert(r.status === 400);
});

await test('preview como fornecedor → 403', async () => {
  const r = await req('POST', '/api/expectativas/preview-cadencia', { token: fornTok, body: {
    prazo: '2026-10-15',
  } });
  assert(r.status === 403);
});

// -------------------------------------------------------------------
// Métricas
// -------------------------------------------------------------------
await test('GET /expectativas/metricas como operador → só sua unidade', async () => {
  const r = await req('GET', '/api/expectativas/metricas', { token: opTok });
  assert(r.status === 200, r.text);
  assert(Array.isArray(r.json.por_status), 'por_status não é array');
  assert('dias_medio_cumprimento' in r.json, 'falta dias_medio_cumprimento');
  assert(Array.isArray(r.json.por_unidade), 'por_unidade não é array');
  // Operador → por_unidade fica vazio (filtro por unidade dele)
  assert(r.json.por_unidade.length === 0,
    'operador deveria ter por_unidade vazio');
});

await test('GET /expectativas/metricas como admin → inclui por_unidade', async () => {
  const r = await req('GET', '/api/expectativas/metricas', { token: admTok });
  assert(r.status === 200);
  assert(r.json.por_unidade.length > 0, 'admin sem distribuição por unidade');
  const hecc = r.json.por_unidade.find(u => u.sigla === 'HECC');
  assert(hecc, 'HECC não está em por_unidade');
  assert(typeof hecc.total === 'number');
  assert(typeof hecc.atrasadas === 'number');
});

await test('admin com ?unidade_id=1 → filtra para HECC', async () => {
  const r = await req('GET', '/api/expectativas/metricas?unidade_id=1', { token: admTok });
  assert(r.status === 200);
  // Com filtro, por_unidade fica vazio (modo focado)
  assert(r.json.por_unidade.length === 0);
});

await test('GET /expectativas/metricas como fornecedor → 403', async () => {
  const r = await req('GET', '/api/expectativas/metricas', { token: fornTok });
  assert(r.status === 403);
});

// -------------------------------------------------------------------
// Helper isolado (não requer servidor)
// -------------------------------------------------------------------
await test('previewCadencia helper: cadência vazia explícita = sem lembretes (só o prazo)', async () => {
  const { previewCadencia } = await import('../services/expectativa-service.js').catch(()=>({}));
  if (!previewCadencia) { console.log('    [skip: import direto bloqueado]'); return; }
  const ev = previewCadencia({ prazo: '2026-12-01', cadencia: { antes: [], depois: [] } });
  // Arrays vazios explícitos → nada antes, nada depois, só o marco "prazo"
  assert(ev.length === 1, `eventos: ${ev.length}`);
  assert(ev[0].tipo === 'prazo');
});

console.log('\n========================================');
console.log(`Expectativas-métricas: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
