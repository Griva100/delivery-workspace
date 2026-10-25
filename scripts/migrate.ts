import { readFile } from 'node:fs/promises';
import { createDeps, closeDeps } from '../server/deps.js';
const deps = createDeps({ database: process.env.DATABASE_URL, redis: undefined, mode: 'inline' });
const client = await deps.pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(735421)');
  await client.query(
    await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'),
  );
  await client.query('COMMIT');
  console.log('Database schema is ready.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await closeDeps(deps);
}
