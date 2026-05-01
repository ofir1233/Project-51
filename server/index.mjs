import express from 'express';
import { config } from './config.mjs';
import { migrate } from './migrate.mjs';
import { healthRouter } from './routes/health.mjs';
import { staticRouter } from './routes/static.mjs';
import { generationsRouter } from './routes/generations.mjs';
import { providersRouter } from './routes/providers.mjs';
import { judgmentsRouter } from './routes/judgments.mjs';
import { refsRouter } from './routes/refs.mjs';
import { labAssetsRouter } from './routes/labAssets.mjs';
import { tunablesRouter } from './routes/tunables.mjs';
import { chainRouter } from './routes/chain.mjs';
import { snapshotsRouter } from './routes/snapshots.mjs';
import { approvalsRouter } from './routes/approvals.mjs';
import { elementsRouter } from './routes/elements.mjs';

// Run schema bootstrap before serving requests. Idempotent.
migrate();

const app = express();

// JSON body parsing for /api routes — 25mb covers base64-encoded reference uploads
app.use(express.json({ limit: '25mb' }));

// CORS guardrails — allow same-origin only (no wildcard)
app.use((req, res, next) => {
  const origin = req.get('origin');
  const allowed = [
    `http://${config.host}:${config.port}`,
    `http://localhost:${config.port}`,
  ];
  if (!origin || allowed.includes(origin)) {
    if (origin) res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Lab-Token');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Mount API first so static fallback doesn't shadow it
app.use('/api', healthRouter);
app.use('/api', providersRouter);
app.use('/api', generationsRouter);
app.use('/api', judgmentsRouter);
app.use('/api', refsRouter);
app.use('/api', tunablesRouter);
app.use('/api', chainRouter);
app.use('/api', snapshotsRouter);
app.use('/api', approvalsRouter);
app.use('/api', elementsRouter);

// Lab-asset binary serving (DB-tracked files under .lab/)
app.use(labAssetsRouter);

// Static last (existing site + lab files)
app.use(staticRouter);

// 404 for unmatched API routes
app.use('/api/*', (req, res) => res.status(404).json({ error: 'not found' }));

// Bind to localhost only — never expose this to the network
const server = app.listen(config.port, config.host, () => {
  console.info(`[lab] http://${config.host}:${config.port}/p51/synthesis`);
  console.info(`[lab] http://${config.host}:${config.port}/p51/lab.html`);
  console.info(`[lab] /api/health`);
  if (process.argv.includes('--open-lab')) {
    const url = `http://${config.host}:${config.port}/p51/lab.html`;
    import('node:child_process').then(({ exec }) => {
      const cmd = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd);
    });
  }
});

process.on('SIGINT', () => {
  console.info('\n[lab] shutting down');
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
