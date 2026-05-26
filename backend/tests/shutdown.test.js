// =====================================================================
// Graceful shutdown — SIGTERM/SIGINT drena requests e sai limpo
// Spawna um server filho, envia SIGTERM, valida comportamento.
// =====================================================================
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

let passed = 0; let failed = 0;
function test(nome, ok, detail) {
  if (ok) { console.log(`  ✓ ${nome}`); passed++; }
  else { console.log(`  ✗ ${nome}\n    ${detail || ''}`); failed++; }
}

console.log('\n[Graceful shutdown]');

// Sobe servidor filho em porta separada
const PORT = 3099;
const proc = spawn('node', ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), LOG_QUIET: '1', ESCALONAMENTO_INTERVALO_MS: '0', PGLITE_MEMORY: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
proc.stdout.on('data', d => { stdout += d.toString(); });
proc.stderr.on('data', d => { stdout += d.toString(); });

// Espera servidor subir
await wait(4000);

const BASE = `http://localhost:${PORT}`;
try {
  const r = await fetch(`${BASE}/api/health`);
  test('servidor filho responde antes do shutdown', r.status === 200);
} catch (e) {
  test('servidor filho responde antes do shutdown', false, e.message);
}

// Envia SIGTERM e espera saída
const tStart = Date.now();
proc.kill('SIGTERM');
const exitCode = await new Promise((resolve) => {
  proc.on('exit', code => resolve(code));
  setTimeout(() => resolve(-1), 15000);
});
const dur = Date.now() - tStart;

test('processo saiu (não travou)', exitCode !== -1, `code=${exitCode}, dur=${dur}ms`);
test('saída em menos de 10s (timeout configurado)', dur < 10000, `tomou ${dur}ms`);
test('código de saída 0 (clean exit)', exitCode === 0, `code=${exitCode}`);
test('log mostra "SIGTERM recebido"', /SIGTERM recebido/.test(stdout), stdout.substring(0, 200));
test('log mostra "shutdown completo"', /shutdown completo/.test(stdout), stdout.substring(0, 200));

// Sanity: porta liberada
try {
  await fetch(`${BASE}/api/health`);
  test('servidor não responde mais (porta liberada)', false, 'ainda respondeu');
} catch {
  test('servidor não responde mais (porta liberada)', true);
}

console.log('\n========================================');
console.log(`Shutdown: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
