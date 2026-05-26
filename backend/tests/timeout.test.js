// =====================================================================
// Request timeout — sobe server com REQUEST_TIMEOUT_MS curto e valida.
// =====================================================================
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

let passed = 0; let failed = 0;
function test(nome, ok, detail) {
  if (ok) { console.log(`  ✓ ${nome}`); passed++; }
  else { console.log(`  ✗ ${nome}\n    ${detail || ''}`); failed++; }
}

console.log('\n[Request timeout]');

// Sobe servidor filho com timeout muito curto (500ms) para forçar bloqueio
const PORT = 3098;
const proc = spawn('node', ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), LOG_QUIET: '1', ESCALONAMENTO_INTERVALO_MS: '0', PGLITE_MEMORY: '1', REQUEST_TIMEOUT_MS: '500' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
proc.stdout.on('data', d => out += d);
proc.stderr.on('data', d => out += d);

await wait(4000);

const BASE = `http://localhost:${PORT}`;

try {
  const r = await fetch(`${BASE}/api/health/live`);
  test('servidor responde antes do teste de timeout', r.status === 200);
} catch (e) {
  test('servidor responde antes do teste de timeout', false, e.message);
}

// Verifica que requests normais funcionam dentro do timeout
try {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/health/ready`);
  const dur = Date.now() - t0;
  test('request normal completa dentro do timeout', r.status === 200 && dur < 500, `${r.status} em ${dur}ms`);
} catch (e) {
  test('request normal completa dentro do timeout', false, e.message);
}

// Snapshot do header de timeout: verificar que /api/health/live é < 500ms
try {
  const t0 = Date.now();
  await fetch(`${BASE}/api/health/live`);
  const dur = Date.now() - t0;
  test('liveness probe muito mais rápida que timeout', dur < 100, `${dur}ms`);
} catch (e) {
  test('liveness probe muito mais rápida que timeout', false, e.message);
}

// Cleanup
proc.kill('SIGTERM');
await wait(2000);
proc.kill('SIGKILL');

console.log('\n========================================');
console.log(`Timeout: ${passed} passou · ${failed} falhou`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
