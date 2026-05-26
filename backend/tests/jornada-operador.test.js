// =====================================================================
// V222 / Fase 3C — quick wins jornada operador
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
  return r.json.token;
}

console.log('\n[Jornada operador (V222)]');

let opTok, fornTok;
await test('logins', async () => {
  opTok = await login('carlos.souza@fesfsus.ba.gov.br');
  fornTok = await login('contato@empresahosp.com.br');
});

// O5: motivo manual mínimo 10 chars
await test('O5: lancamento manual rejeita motivo < 10 chars', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const fornId = (await req('GET', '/api/fornecedores', { token: opTok })).json.fornecedores[0].id;
  const r = await req('POST', '/api/envios/manual', { token: opTok,
    body: { fornecedor_id: fornId, unidade_id: heccId, modalidade_id: modId,
      competencia: '2026-02', valor_centavos: 100, numero_nf: 'V222-1',
      motivo: 'curto' } }); // 5 chars
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
  assert(/>=10|10 chars|mais detalhes|descrev/i.test(r.json.error || ''), `msg sem dica de min: ${r.json.error}`);
});

await test('O5: motivo com 10+ chars aceito', async () => {
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  const fornId = (await req('GET', '/api/fornecedores', { token: opTok })).json.fornecedores[0].id;
  const r = await req('POST', '/api/envios/manual', { token: opTok,
    body: { fornecedor_id: fornId, unidade_id: heccId, modalidade_id: modId,
      competencia: '2026-02', valor_centavos: 100, numero_nf: 'V222-2',
      motivo: 'Fornecedor nao tinha email para receber link publico — autorizou por telefone' } });
  assert(r.status === 201 || r.status === 200, `status ${r.status} ${r.text}`);
});

// O3: notificação de reenvio inclui nome do documento
await test('O3: solicitar reenvio com documento_id inclui nome na notif', async () => {
  // Pega um envio do fornecedor, faz upload de um documento, depois solicita reenvio dele
  const fornId = (await req('GET', '/api/fornecedores', { token: opTok })).json.fornecedores[0].id;
  const heccId = (await req('GET', '/api/unidades')).json.unidades.find(u => u.sigla === 'HECC').id;
  const modId = (await req('GET', '/api/modalidades')).json.modalidades.find(m => m.codigo === 'indenizatorio_moe').id;
  // Cria envio
  const env = (await req('POST', '/api/envios/portal', { token: fornTok,
    body: { unidade_id: heccId, modalidade_id: modId, competencia: '2026-03', valor_centavos: 100, numero_nf: 'V222-R-' + Date.now() } })).json.envio;
  // Upload doc
  const fd = new FormData();
  fd.append('arquivo', new Blob(['nf de exemplo'], { type: 'text/plain' }), 'nf-marco-2026.pdf');
  fd.append('campo', 'q5_nf');
  const upR = await fetch(`${BASE}/api/envios/${env.id}/documentos`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + fornTok },
    body: fd
  });
  assert(upR.status === 201, `upload status ${upR.status}`);
  const docId = (await upR.json()).documento.id;
  // Conta notifs antes
  const antes = (await req('GET', '/api/notificacoes', { token: fornTok })).json.notificacoes.length;
  // Solicita reenvio do doc
  const rr = await req('POST', `/api/envios/${env.id}/solicitar-reenvio`, { token: opTok,
    body: { campo: 'q5_nf', documento_id: docId, motivo: 'arquivo ilegivel — favor reenviar com qualidade superior' } });
  assert(rr.status === 201, `solicitar-reenvio status ${rr.status} ${rr.text}`);
  assert(rr.json.documento_nome === 'nf-marco-2026.pdf', `nome doc no response: ${rr.json.documento_nome}`);
  // Notificação contém o nome do arquivo
  const notifs = (await req('GET', '/api/notificacoes', { token: fornTok })).json.notificacoes;
  assert(notifs.length > antes, 'fornecedor nao recebeu notificacao');
  const ultima = notifs[0];
  assert(/nf-marco-2026\.pdf/.test(ultima.mensagem), `notif sem nome do doc: ${ultima.mensagem}`);
});

console.log('\n========================================');
console.log(`Jornada-operador: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
