import { createDeps, closeDeps } from './deps.js';
import { startReportWorker } from './reports.js';
if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
const deps = createDeps({ database: process.env.DATABASE_URL, redis: undefined, mode: 'inline' }),
  worker = startReportWorker(deps.pool, process.env.REDIS_URL);
console.log('Report worker started');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await worker.close();
    await closeDeps(deps);
    process.exit(0);
  });
