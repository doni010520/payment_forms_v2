// =====================================================================
// DB Adapter — suporta dois backends:
//   1. PGlite (WASM embedded)  — default para dev e testes
//   2. pg (PostgreSQL real)    — quando DATABASE_URL está setado
//
// A API exposta (query, queryOne, truncateAll, getDb, closeDb, initSchema)
// é idêntica para os dois. O código de rotas/serviços não precisa saber.
// =====================================================================
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Singleton + flag de modo
let _db = null;
let _initPromise = null;
let _mode = null; // 'pglite' | 'pg'

function modoConfigurado() {
  return process.env.DATABASE_URL ? 'pg' : 'pglite';
}

/**
 * Inicializa (ou retorna) a instância do banco.
 *
 * Variáveis de ambiente:
 *   DATABASE_URL          → usa pg (Postgres real). Ex.: postgres://user:pass@host:5432/db
 *   PGLITE_MEMORY=1       → (modo pglite) usa memória em vez de disco
 *
 * Default: PGlite persistente em ./pgdata
 */
export async function getDb() {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    _mode = modoConfigurado();
    if (_mode === 'pg') {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      // adapta interface para casar com PGlite
      _db = {
        backend: 'pg',
        query: (text, params) => pool.query(text, params),
        exec: async (sql) => {
          // pg.Pool não tem exec multi-statement; usa client dedicado
          const client = await pool.connect();
          try { await client.query(sql); } finally { client.release(); }
        },
        close: () => pool.end(),
      };
      console.log('[db] Usando PostgreSQL real via DATABASE_URL');
    } else {
      const { PGlite } = await import('@electric-sql/pglite');
      const useMemory = process.env.PGLITE_MEMORY === '1';
      const dataDir = useMemory ? undefined : join(__dirname, '..', '.pgdata');
      const pglite = new PGlite(dataDir);
      await pglite.waitReady;
      _db = {
        backend: 'pglite',
        query: (text, params) => pglite.query(text, params),
        exec: (sql) => pglite.exec(sql),
        close: () => pglite.close(),
        _raw: pglite,
      };
      console.log(`[db] Usando PGlite (${useMemory ? 'memória' : 'disco em ./pgdata'})`);
    }
    return _db;
  })();

  return _initPromise;
}

/**
 * Cria todas as tabelas executando schema.sql.
 * Idempotente: usa CREATE TABLE IF NOT EXISTS.
 */
export async function initSchema() {
  const db = await getDb();
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf-8');
  await db.exec(sql);
  return true;
}

/**
 * Sistema de migrações incrementais.
 * Lê db/migrations/*.sql em ordem alfabética e aplica as não-aplicadas.
 * Tracking em tabela _schema_migrations (auto-criada).
 *
 * Padrão: arquivos 001_xxx.sql, 002_yyy.sql, etc. Idempotência via IF NOT EXISTS.
 * Uso: chamar runMigrations() após initSchema() no boot do servidor.
 */
export async function runMigrations() {
  const db = await getDb();
  // Tabela de tracking
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      nome TEXT PRIMARY KEY,
      aplicada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const dir = join(__dirname, 'migrations');
  let arquivos = [];
  try { arquivos = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort(); }
  catch { return { aplicadas: [], puladas: [] }; }
  const { rows: jaAplicadas } = await db.query('SELECT nome FROM _schema_migrations');
  const setAplicadas = new Set(jaAplicadas.map(r => r.nome));
  const aplicadas = [];
  const puladas = [];
  for (const arquivo of arquivos) {
    if (setAplicadas.has(arquivo)) { puladas.push(arquivo); continue; }
    const sql = await readFile(join(dir, arquivo), 'utf-8');
    try {
      await db.exec(sql);
      await db.query('INSERT INTO _schema_migrations (nome) VALUES ($1)', [arquivo]);
      aplicadas.push(arquivo);
      console.log(`[migrations] ✓ aplicada: ${arquivo}`);
    } catch (e) {
      console.error(`[migrations] ✗ falhou em ${arquivo}:`, e.message);
      throw e;
    }
  }
  return { aplicadas, puladas };
}

/**
 * Retorna status das migrações para diagnóstico.
 */
export async function statusMigrations() {
  const db = await getDb();
  try {
    const { rows } = await db.query('SELECT nome, aplicada_em FROM _schema_migrations ORDER BY nome');
    return rows;
  } catch { return []; }
}

/**
 * Helper: roda query parametrizada e retorna { rows }.
 * Compatível com pg e PGlite (ambos retornam `rows`).
 */
export async function query(text, params = []) {
  const db = await getDb();
  return db.query(text, params);
}

/**
 * Helper: retorna primeira row ou null.
 */
export async function queryOne(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

/**
 * Limpa todas as tabelas (uso em testes).
 */
export async function truncateAll() {
  const db = await getDb();
  // NOTA: NÃO incluir _schema_migrations nem _idempotency (persistem entre resets)
  const tables = [
    'configuracoes',
    'usuario_unidades',
    'solicitacoes_reenvio',
    'pagamentos',
    'anotacoes_documento',
    'anotacoes_envio',
    'emails_simulados',
    'comentarios',
    'notificacoes',
    'auditoria',
    'lembretes',
    'documentos',
    'versoes_envio',
    'envios',
    'links_publicos',
    'expectativas',
    'modalidades',
    'usuarios',
    'fornecedor_unidades',
    'fornecedores',
    'unidades',
  ];
  // pg suporta TRUNCATE com múltiplas tabelas separadas por vírgula; PGlite também.
  // Faz um por um para máxima compatibilidade.
  for (const t of tables) {
    await db.exec(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
  }
}

/**
 * Fecha o pool/conexão (uso em testes).
 */
export async function closeDb() {
  if (_db) {
    await _db.close();
    _db = null;
    _initPromise = null;
    _mode = null;
  }
}

/**
 * Retorna informação sobre o backend ativo (para diagnóstico).
 */
export function dbBackend() {
  return _mode || modoConfigurado();
}
