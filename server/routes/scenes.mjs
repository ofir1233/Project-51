// /api/scenes — the only data route the online Lab needs.
//
//   POST   /api/scenes          generate, sample, persist; returns the new row
//   GET    /api/scenes          list the caller's non-expired scenes (newest first)
//   GET    /api/scenes/:id      read one (RLS guarantees ownership)
//   DELETE /api/scenes/:id      remove one
//
// All handlers run as the calling user via userSupabase(req.jwt) — RLS in
// Postgres prevents touching anyone else's rows even if the WHERE clause
// were missing.

import { Router } from 'express';
import { ulid } from '../util/ids.mjs';
import { userSupabase } from '../supabase.mjs';
import { generateImage } from '../util/generate.mjs';
import { sampleGridFromImage } from '../util/sample-grid.mjs';
import { onlineConfig } from '../online-config.mjs';

export const scenesRouter = Router();

scenesRouter.post('/scenes', async (req, res) => {
  const prompt = (req.body?.prompt || '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (prompt.length > 2000) return res.status(400).json({ error: 'prompt too long' });

  let bytes, mime, provider, model;
  try {
    const out = await generateImage({ prompt });
    bytes = out.bytes; mime = out.mime; provider = out.provider; model = out.model;
  } catch (e) {
    return res.status(502).json({ error: 'generation failed', detail: e.message });
  }

  let grid;
  try {
    grid = await sampleGridFromImage(bytes, { gridSize: onlineConfig.gridSize });
  } catch (e) {
    return res.status(500).json({ error: 'sampling failed', detail: e.message });
  }
  // bytes goes out of scope here — never written to disk, never uploaded.
  bytes = null;

  const now = Date.now();
  const row = {
    id:         ulid(),
    user_id:    req.user.id,
    created_at: now,
    expires_at: now + onlineConfig.sceneTtlMs,
    prompt,
    provider,
    model,
    grid_w:     grid.w,
    grid_h:     grid.h,
    point_grid: { lum: grid.lum, srcWidth: grid.srcWidth, srcHeight: grid.srcHeight },
    notes:      null,
  };

  const sb = userSupabase(req.jwt);
  const { data, error } = await sb.from('scenes').insert(row).select().single();
  if (error) return res.status(500).json({ error: 'db insert failed', detail: error.message });
  res.json({ scene: data });
});

scenesRouter.get('/scenes', async (req, res) => {
  const sb = userSupabase(req.jwt);
  const { data, error } = await sb
    .from('scenes')
    .select('id, created_at, expires_at, prompt, provider, model, grid_w, grid_h, notes')
    .gt('expires_at', Date.now())
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: 'db query failed', detail: error.message });
  res.json({ scenes: data });
});

scenesRouter.get('/scenes/:id', async (req, res) => {
  const sb = userSupabase(req.jwt);
  const { data, error } = await sb
    .from('scenes')
    .select('*')
    .eq('id', req.params.id)
    .gt('expires_at', Date.now())
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'db query failed', detail: error.message });
  if (!data) return res.status(404).json({ error: 'not found or expired' });
  res.json({ scene: data });
});

scenesRouter.delete('/scenes/:id', async (req, res) => {
  const sb = userSupabase(req.jwt);
  const { error } = await sb.from('scenes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'db delete failed', detail: error.message });
  res.json({ ok: true });
});
