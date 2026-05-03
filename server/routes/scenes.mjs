// /api/scenes — chain-driven generation with NDJSON streaming progress.
//
//   POST   /api/scenes          run the agent chain, stream progress events
//                                as newline-delimited JSON, persist final scene
//   GET    /api/scenes          list the caller's non-expired scenes
//   GET    /api/scenes/:id      read one
//   DELETE /api/scenes/:id      remove one
//
// All handlers run as the calling user via userSupabase(req.jwt) — RLS in
// Postgres prevents touching anyone else's rows even if WHERE is missing.

import { Router } from 'express';
import { ulid } from '../util/ids.mjs';
import { userSupabase } from '../supabase.mjs';
import { runChain } from '../util/chain.mjs';
import { sampleGridFromImage } from '../util/sample-grid.mjs';
import { onlineConfig } from '../online-config.mjs';

export const scenesRouter = Router();

scenesRouter.post('/scenes', async (req, res) => {
  const goal = (req.body?.prompt || '').toString().trim();
  if (!goal) return res.status(400).json({ error: 'prompt required' });
  if (goal.length > 2000) return res.status(400).json({ error: 'prompt too long' });

  // Optional reference image — base64-encoded in the body. Decoded into a
  // single Buffer that's passed to gemini-image as an image-to-image ref.
  // Bytes never persist; they exist only for the duration of this request.
  let refBytes = [];
  if (req.body?.refImage && typeof req.body.refImage === 'string') {
    try {
      const b64 = req.body.refImage.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 6 * 1024 * 1024) return res.status(413).json({ error: 'ref image too large (max 6MB)' });
      if (buf.length > 0) refBytes = [buf];
    } catch {
      return res.status(400).json({ error: 'ref image not valid base64' });
    }
  }

  // NDJSON streaming response. Each line is a self-contained JSON event.
  res.set({
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no', // disable proxy buffering on Render
  });
  const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch {} };
  const ac = new AbortController();
  req.on('close', () => ac.abort());

  let final = null;
  try {
    for await (const ev of runChain({ goal, refBytes, abortSignal: ac.signal })) {
      if (ev.type === 'done') { final = ev; break; }
      send(ev);
    }
  } catch (e) {
    send({ type: 'error', error: 'chain failed', detail: e.message });
    return res.end();
  }
  if (!final) {
    send({ type: 'error', error: 'chain ended without result' });
    return res.end();
  }

  // Sample to luminance grid in memory; bytes never written to disk.
  let grid;
  try {
    send({ type: 'step', step: 'sampling point cloud' });
    grid = await sampleGridFromImage(final.bytes, { gridSize: onlineConfig.gridSize });
  } catch (e) {
    send({ type: 'error', error: 'sampling failed', detail: e.message });
    return res.end();
  }
  // Drop bytes from memory.
  final.bytes = null;

  const now = Date.now();
  const row = {
    id:         ulid(),
    user_id:    req.user.id,
    created_at: now,
    expires_at: now + onlineConfig.sceneTtlMs,
    prompt:     goal,
    provider:   final.provider,
    model:      final.model,
    grid_w:     grid.w,
    grid_h:     grid.h,
    point_grid: { lum: grid.lum, srcWidth: grid.srcWidth, srcHeight: grid.srcHeight, finalPrompt: final.finalPrompt, score: final.score, iterations: final.iterations },
    notes:      null,
  };

  send({ type: 'step', step: 'saving scene' });
  const sb = userSupabase(req.jwt);
  const { data, error } = await sb.from('scenes').insert(row).select().single();
  if (error) {
    send({ type: 'error', error: 'db insert failed', detail: error.message });
    return res.end();
  }

  send({ type: 'done', scene: data });
  res.end();
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
