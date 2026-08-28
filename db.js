// Shared Postgres connection, reused across serverless function invocations.
import { Pool } from 'pg';

let pool;

// VentText's tables live in a dedicated `venttext` Postgres schema (so they can
// share a database without colliding with anything in `public`). We set the
// search_path on every connection so the app's unqualified table names resolve.
// Override with DB_SCHEMA if you ever move to a dedicated database/public schema.
const SCHEMA = process.env.DB_SCHEMA || 'venttext,public';

export function getDb() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      options: `-c search_path=${SCHEMA}`,
    });
    // Belt-and-suspenders: also set it on each fresh connection.
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${SCHEMA}`).catch(() => {});
    });
  }
  return pool;
}
