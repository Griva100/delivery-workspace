import express from 'express';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { createDeps, closeDeps } from './deps.js';
const deps = createDeps(),
  app = createApp(deps);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4188);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () =>
  console.log(`Delivery Workspace: http://127.0.0.1:${port}`),
);
process.on('SIGINT', () =>
  server.close(async () => {
    await closeDeps(deps);
    process.exit(0);
  }),
);
