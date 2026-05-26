import { query, closeDb } from '../db/index.js';

const checks = [
  ['unidades',     8],
  ['modalidades',  6],
  ['fornecedores', 8],
  ['usuarios',    13], // 1 admin + 8 operadores + 4 fornecedores com_portal
  ['envios',       3],
  ['expectativas', 3],
  ['links_publicos', 1],
];

let ok = true;
for (const [tbl, esperado] of checks) {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM ${tbl}`);
  const got = rows[0].n;
  const status = got === esperado ? '✓' : '✗';
  if (got !== esperado) ok = false;
  console.log(`${status} ${tbl.padEnd(18)} esperado=${esperado} obtido=${got}`);
}

// Check origem distribution
const { rows: origens } = await query(`SELECT origem, COUNT(*)::int AS n FROM envios GROUP BY origem ORDER BY origem`);
console.log('\nDistribuicao por origem:');
for (const r of origens) console.log(`  ${r.origem.padEnd(15)} ${r.n}`);

// Check expectativas por status
const { rows: statusExp } = await query(`SELECT status, COUNT(*)::int AS n FROM expectativas GROUP BY status ORDER BY status`);
console.log('\nExpectativas por status:');
for (const r of statusExp) console.log(`  ${r.status.padEnd(15)} ${r.n}`);

await closeDb();
process.exit(ok ? 0 : 1);
