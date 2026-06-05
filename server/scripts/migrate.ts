import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = join(dirname(currentFile), '../..');
const migrationsDir = join(projectRoot, 'database');

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const applied = await pool.query('SELECT name FROM schema_migrations WHERE name = $1', [file]);
    if (applied.rows[0]) {
      console.log(`Skipping ${file}`);
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
