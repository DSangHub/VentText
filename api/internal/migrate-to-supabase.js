import { timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';

// Temporary, token-protected migration route. Remove after the database cutover.
export const config = { maxDuration: 60 };

const tables = ['merchants', 'customers', 'conversations', 'messages'];
const maxRowsPerTable = 5000;
let sourcePool;

function getSourceDb() {
  if (!sourcePool) {
    sourcePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    sourcePool.on('connect', client => {
      client.query('SET search_path TO venttext, public').catch(() => {});
    });
  }
  return sourcePool;
}

function authorized(req) {
  const expected = process.env.VENTTEXT_MIGRATION_TOKEN;
  const actual = req.headers['x-migration-token'];
  if (!expected || typeof actual !== 'string') return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function identifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(404).json({ error: 'Not found' });
  if (req.body?.inspect === true) {
    try {
      const counts = {};
      for (const table of tables) {
        const result = await getSourceDb().query(`SELECT count(*)::int AS count FROM ${identifier(table)}`);
        counts[table] = result.rows[0].count;
      }
      return res.status(200).json({ sourceCounts: counts });
    } catch (error) {
      console.error('VentText source inspection failed:', error.message);
      return res.status(500).json({ error: 'Could not inspect source row counts.' });
    }
  }
  if (!process.env.SUPABASE_DATABASE_URL) {
    return res.status(503).json({ error: 'Target database is not configured' });
  }

  const source = await getSourceDb().connect();
  const targetPool = new Pool({
    connectionString: process.env.SUPABASE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  let target;
  let sourceTransaction = false;
  let targetTransaction = false;
  try {
    target = await targetPool.connect();
    await source.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    sourceTransaction = true;
    await target.query('BEGIN');
    targetTransaction = true;

    const counts = {};
    for (const table of tables) {
      const sourceData = await source.query(`SELECT * FROM ${identifier(table)} LIMIT ${maxRowsPerTable + 1}`);
      if (sourceData.rows.length > maxRowsPerTable) {
        throw new Error(`The ${table} table exceeds the migration limit`);
      }

      const destination = await target.query(`SELECT * FROM venttext.${identifier(table)} LIMIT 0`);
      const destinationColumns = new Set(destination.fields.map(field => field.name));
      const columns = sourceData.fields.map(field => field.name)
        .filter(column => destinationColumns.has(column));
      if (!columns.includes('id')) throw new Error(`No matching id column for ${table}`);

      for (const row of sourceData.rows) {
        const values = columns.map(column => row[column]);
        const names = columns.map(identifier).join(', ');
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        await target.query(
          `INSERT INTO venttext.${identifier(table)} (${names}) VALUES (${placeholders})
           ON CONFLICT (id) DO NOTHING`,
          values,
        );
      }

      const destinationIds = await target.query(`SELECT id FROM venttext.${identifier(table)}`);
      const ids = new Set(destinationIds.rows.map(row => String(row.id)));
      if (sourceData.rows.some(row => !ids.has(String(row.id)))) {
        throw new Error(`Migration verification failed for ${table}`);
      }
      counts[table] = { source: sourceData.rows.length, target: destinationIds.rows.length };
    }

    await target.query('COMMIT');
    targetTransaction = false;
    await source.query('ROLLBACK');
    sourceTransaction = false;
    return res.status(200).json({ migrated: true, counts });
  } catch (error) {
    if (targetTransaction) await target?.query('ROLLBACK').catch(() => {});
    if (sourceTransaction) await source.query('ROLLBACK').catch(() => {});
    console.error('VentText migration failed:', error.message);
    return res.status(500).json({ error: 'Migration failed without committing target changes.' });
  } finally {
    target?.release();
    source.release();
    await targetPool.end();
  }
}
