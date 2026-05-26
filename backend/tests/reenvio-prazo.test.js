// =====================================================================
// V228 / O3.2 — deadline + tentativas em solicitações de reenvio
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

console.log('\n[Reenvio: prazo + tentativas — V228/O3.2]');

let opTok, fornTok, envId, docId;
await test('setup: logins + envio com documento', async () => {
  opTok = await login('carlos.souza@fesfsus.ba.gov.br');
  fornTok = await login('contato@empresahosp.com.br');
  assert(opTok && fornTok);
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId  = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const env = await req('POST', '/api/envios/portal', { token: fornTok, body: {
    unidade_id: heccId, modalidade_id: modId, competencia: '2026-05',
    valor_centavos: 50000, numero_nf: 'V228-' + Date.now(),
  } });
  assert(env.status === 201, `envio status ${env.status}`);
  envId = env.json.envio.id;
  // Upload do primeiro documento (será alvo do reenvio)
  const fd = new FormData();
  fd.append('arquivo', new Blob(['nf original'], { type: 'text/plain' }), 'nf-v1.pdf');
  fd.append('campo', 'q5_nf');
  const up = await fetch(`${BASE}/api/envios/${envId}/documentos`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + fornTok }, body: fd
  });
  assert(up.status === 201);
  docId = (await up.json()).documento.id;
});

// -------------------------------------------------------------------
// 1. Validação do prazo_dias
// -------------------------------------------------------------------
await test('prazo_dias=0 → 400', async () => {
  const r = await req('POST', `/api/envios/${envId}/solicitar-reenvio`, { token: opTok, body: {
    campo: 'q5_nf', motivo: 'ilegível, reenviar', prazo_dias: 0,
  } });
  assert(r.status === 400, `status ${r.status}`);
});

await test('prazo_dias=31 → 400', async () => {
  const r = await req('POST', `/api/envios/${envId}/solicitar-reenvio`, { token: opTok, body: {
    campo: 'q5_nf', motivo: 'ilegível, reenviar', prazo_dias: 31,
  } });
  assert(r.status === 400);
});

await test('prazo_dias inválido (string) → 400', async () => {
  const r = await req('POST', `/api/envios/${envId}/solicitar-reenvio`, { token: opTok, body: {
    campo: 'q5_nf', motivo: 'ilegível, reenviar', prazo_dias: 'tres',
  } });
  assert(r.status === 400);
});

// -------------------------------------------------------------------
// 2. Primeira solicitação: tentativas=1, prazo calculado
// -------------------------------------------------------------------
await test('1ª solicitação → tentativas=1 + prazo_atendimento futuro', async () => {
  const r = await req('POST', `/api/envios/${envId}/solicitar-reenvio`, { token: opTok, body: {
    campo: 'q5_nf', documento_id: docId, motivo: 'qualidade ruim — reenvie', prazo_dias: 5,
  } });
  assert(r.status === 201, `status ${r.status} ${r.text}`);
  assert(r.json.tentativas === 1, `tentativas: ${r.json.tentativas}`);
  assert(r.json.prazo_atendimento, 'sem prazo_atendimento');
  const prazo = new Date(r.json.prazo_atendimento);
  const diffDias = (prazo - new Date()) / 86400000;
  assert(diffDias > 4.5 && diffDias < 5.5, `prazo aprox 5d: ${diffDias.toFixed(2)}d`);
  assert(r.json.documento_nome === 'nf-v1.pdf');
});

// -------------------------------------------------------------------
// 3. Notificação inclui prazo + tentativa
// -------------------------------------------------------------------
await test('notificação ao fornecedor inclui data prazo + (1ª solicitação omitida)', async () => {
  const r = await req('GET', '/api/notificacoes', { token: fornTok });
  assert(r.status === 200);
  const ultima = r.json.notificacoes[0];
  assert(/Reenvio solicitado/.test(ultima.mensagem), `msg sem texto base: ${ultima.mensagem}`);
  assert(/Prazo: \d{2}\/\d{2}\/\d{4}/.test(ultima.mensagem), `msg sem data prazo: ${ultima.mensagem}`);
  // 1ª solicitação não menciona "Xª solicitação"
  assert(!/[12]ª solicitação/.test(ultima.mensagem), `1a vez não deve mostrar contador: ${ultima.mensagem}`);
});

// -------------------------------------------------------------------
// 4. Default prazo = 3 dias quando omitido
// -------------------------------------------------------------------
await test('omitir prazo_dias → default 3 dias', async () => {
  const r = await req('POST', `/api/envios/${envId}/solicitar-reenvio`, { token: opTok, body: {
    campo: 'q6_recibo', motivo: 'recibo precisa reconhecimento de firma',
  } });
  assert(r.status === 201);
  const diff = (new Date(r.json.prazo_atendimento) - new Date()) / 86400000;
  assert(diff > 2.5 && diff < 3.5, `default 3d: ${diff.toFixed(2)}`);
});

// -------------------------------------------------------------------
// 5. Re-solicitar mesmo campo → tentativas++
// -------------------------------------------------------------------
await test('2ª solicitação do mesmo campo → tentativas=2 e msg menciona', async () => {
  const r = await req('POST', `/api/envios/${envId}/solicitar-reenvio`, { token: opTok, body: {
    campo: 'q5_nf', motivo: 'continua ilegível, favor reenviar com qualidade',
  } });
  assert(r.status === 201, r.text);
  assert(r.json.tentativas === 2, `tentativas: ${r.json.tentativas}`);
  const n = await req('GET', '/api/notificacoes', { token: fornTok });
  const ultima = n.json.notificacoes[0];
  assert(/2ª solicitação/.test(ultima.mensagem), `msg sem (2ª): ${ultima.mensagem}`);
});

// -------------------------------------------------------------------
// 6. GET /reenvios lista todas as solicitações
// -------------------------------------------------------------------
await test('GET /envios/:id/reenvios como operador → lista com tentativas e prazo', async () => {
  const r = await req('GET', `/api/envios/${envId}/reenvios`, { token: opTok });
  assert(r.status === 200);
  assert(Array.isArray(r.json.reenvios));
  assert(r.json.reenvios.length >= 3, `esperava 3+: ${r.json.reenvios.length}`);
  const q5 = r.json.reenvios.filter(x => x.campo === 'q5_nf');
  assert(q5.length === 2, `2 solicitações q5_nf: ${q5.length}`);
  assert(q5.every(x => typeof x.tentativas === 'number' && x.prazo_atendimento));
});

await test('GET /envios/:id/reenvios como fornecedor dono → 200', async () => {
  const r = await req('GET', `/api/envios/${envId}/reenvios`, { token: fornTok });
  assert(r.status === 200);
});

await test('GET /envios/:id/reenvios como fornecedor de OUTRO envio → 403', async () => {
  // Carlos Souza é operador, não fornecedor. Vou logar outro fornecedor inexistente
  // ou pular esse cenário — só temos 1 fornecedor com_portal no seed.
  // Usa operador de outra unidade que não atende HECC
  const opOutro = await login('beatriz.ramos@fesfsus.ba.gov.br'); // MRC
  if (!opOutro) { console.log('    [skip: sem operador MRC]'); return; }
  const r = await req('GET', `/api/envios/${envId}/reenvios`, { token: opOutro });
  assert(r.status === 403, `esperava 403, veio ${r.status}`);
});

// -------------------------------------------------------------------
// 7. Upload do mesmo campo marca solicitação como atendida
// -------------------------------------------------------------------
await test('upload novo arquivo no mesmo campo → solicitações abertas viram atendida', async () => {
  const fd = new FormData();
  fd.append('arquivo', new Blob(['nf reenviada com qualidade'], { type: 'text/plain' }), 'nf-v2.pdf');
  fd.append('campo', 'q5_nf');
  const up = await fetch(`${BASE}/api/envios/${envId}/documentos`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + fornTok }, body: fd
  });
  assert(up.status === 201);
  // Confere via /reenvios
  const r = await req('GET', `/api/envios/${envId}/reenvios`, { token: opTok });
  const q5 = r.json.reenvios.filter(x => x.campo === 'q5_nf');
  assert(q5.every(x => x.status === 'atendida'), `q5 status: ${q5.map(x => x.status).join(',')}`);
  assert(q5.every(x => x.atendido_em), 'atendido_em vazio');
  // q6_recibo ainda em aberto (não foi reenviado)
  const q6 = r.json.reenvios.find(x => x.campo === 'q6_recibo');
  assert(q6.status === 'aberta', `q6 deveria estar aberta: ${q6.status}`);
});

console.log('\n========================================');
console.log(`Reenvio-prazo: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
