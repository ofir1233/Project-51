// Online entry point — what runs on Render. Intentionally minimal:
//   • /api/health           public health check (Render pings this)
//   • /api/config           public Supabase URL + anon key for the browser SDK
//   • /api/scenes ...       authenticated data routes
//   • static files          login + lab UI from /p51
//
// The local Lab still runs from server/index.mjs unchanged.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { onlineConfig } from './online-config.mjs';
import { requireAuth } from './auth.mjs';
import { scenesRouter } from './routes/scenes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const P51_DIR   = join(ROOT, 'p51');

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS — only allow configured origins (or same-origin if list is empty).
app.use((req, res, next) => {
  const origin = req.get('origin');
  const ok = !origin
    || onlineConfig.allowedOrigins.length === 0
    || onlineConfig.allowedOrigins.includes(origin);
  if (ok && origin) {
    res.set('Access-Control-Allow-Origin',  origin);
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.set('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(ok ? 204 : 403);
  next();
});

// Public — health + bootstrap config for the browser SDK.
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/api/config', (req, res) => res.json({
  supabaseUrl:     onlineConfig.supabaseUrl,
  supabaseAnonKey: onlineConfig.supabaseAnonKey,
  sceneTtlMs:      onlineConfig.sceneTtlMs,
}));

// Authed routes.
app.use('/api', requireAuth, scenesRouter);

// 404 inside /api so static fallback can't shadow a typo'd endpoint.
app.use('/api/*', (req, res) => res.status(404).json({ error: 'not found' }));

// Static + page routes.
app.get('/',     (req, res) => res.sendFile(join(P51_DIR, 'login.html')));
app.get('/lab',  (req, res) => res.sendFile(join(P51_DIR, 'lab-online.html')));
app.use('/p51',  express.static(P51_DIR, { fallthrough: true, index: false }));

app.use((err, req, res, next) => {
  console.error('[online] unhandled:', err);
  res.status(500).json({ error: 'internal' });
});

const server = app.listen(onlineConfig.port, onlineConfig.host, () => {
  console.info(`[online] listening on http://${onlineConfig.host}:${onlineConfig.port}`);
});

process.on('SIGINT',  () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
