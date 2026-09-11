import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { closePool, pool } from './client.js';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

/**
 * Runner de migraciones mínimo: aplica los .sql de /migrations en orden
 * alfabético, una sola vez, cada uno en su propia transacción. Corre al
 * arrancar el contenedor (ver docker-entrypoint.sh) o con `npm run migrate`.
 */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      logger.info({ file }, 'aplicando migración');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, file }, 'falló la migración');
        throw err;
      }
    }

    logger.info({ total: files.length }, 'migraciones al día');
  } finally {
    client.release();
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isDirectRun) {
  migrate()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'no se pudieron aplicar las migraciones');
      process.exit(1);
    });
}
