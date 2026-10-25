import express from 'express';
import { createApp } from '../server/app.js';
import { createDeps } from '../server/deps.js';
const app = process.env.DATABASE_URL
  ? createApp(createDeps())
  : express().use((_req, res) =>
      res.status(503).json({
        error: 'The database connection must be configured before this deployment is ready.',
      }),
    );
export default app;
