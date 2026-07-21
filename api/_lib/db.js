// Shared Postgres connection, reused across serverless function invocations.
import { Pool } from 'pg';

let pool;

export function getDb() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}
