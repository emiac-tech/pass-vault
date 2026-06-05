import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
});

export async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []) {
  const result = await pool.query<T>(sql, values);
  return result;
}

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
