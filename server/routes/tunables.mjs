import { Router } from 'express';
import { db } from '../db.mjs';

export const tunablesRouter = Router();

const DEFAULTS = {
  '--portrait-color':       '#c8ff00',
  '--portrait-color-cold':  '#b8b8b8',
  '--portrait-color-dark':  '#0a0a0a',
  '--portrait-density':     '2',
  '--portrait-point-size':  '1.3',
  '--portrait-depth':       '0.45',
  '--portrait-noise':       '0.028',
  '--portrait-mouse-force': '0.22',
  '--portrait-parallax':    '0.18',
  '--portrait-lum-cutoff':  '0.78',
};

const sseClients = new Set();

tunablesRouter.get('/tunables', (req, res) => {
  const rows = db().prepare(`SELECT k, v FROM kv WHERE k LIKE 'tunable:%'`).all();
  const merged = { ...DEFAULTS };
  for (const r of rows) merged[r.k.slice('tunable:'.length)] = r.v;
  res.json(merged);
});

tunablesRouter.put('/tunables', (req, res) => {
  const { key, value } = req.body || {};
  if (typeof key !== 'string' || typeof value !== 'string')
    return res.status(400).json({ error: 'key+value (strings) required' });
  if (!key.startsWith('--portrait-')) return res.status(400).json({ error: 'unknown key' });

  const ts = Date.now();
  db().prepare(`
    INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at
  `).run(`tunable:${key}`, value, ts);

  // broadcast
  const payload = `event: tunable\ndata: ${JSON.stringify({ key, value, ts })}\n\n`;
  for (const c of sseClients) {
    try { c.write(payload); } catch {}
  }
  res.json({ ok: true });
});

tunablesRouter.get('/tunables/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`); }
    catch { clearInterval(heartbeat); }
  }, 15000);
  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
});
