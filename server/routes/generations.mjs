import { Router } from 'express';
import { db } from '../db.mjs';
import { resolveProvider } from '../providers/index.mjs';
import { ulid } from '../util/ids.mjs';
import { atomicWriteSync, bucketedPath } from '../util/files.mjs';
import { promptHash } from '../util/hash.mjs';
import { paths } from '../paths.mjs';

export const generationsRouter = Router();

// ── LIST ──
generationsRouter.get('/generations', (req, res) => {
  const visibility = req.query.visibility ?? 'visible';
  const starred = req.query.starred;
  const chainRunId = req.query.chainRunId;
  const q = req.query.q;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const before = req.query.before ? Number(req.query.before) : null;

  const where = [];
  const params = {};
  if (visibility !== 'all') { where.push('visibility = @visibility'); params.visibility = visibility; }
  if (starred === '1')      { where.push('starred = 1'); }
  if (chainRunId)           { where.push('chain_run_id = @chainRunId'); params.chainRunId = chainRunId; }
  if (q)                    { where.push('(prompt LIKE @q OR goal LIKE @q)'); params.q = `%${q}%`; }
  if (before)               { where.push('created_at < @before'); params.before = before; }

  const sql = `
    SELECT id, created_at, parent_id, chain_run_id, iteration, goal, prompt,
           ref_ids_json, provider, model, width, height, file_path, thumb_path,
           score, visibility, starred, notes
    FROM generations
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT ${limit}`;

  const rows = db().prepare(sql).all(params).map(rowToGeneration);

  // attach latest user judgment for each row in one extra query
  if (rows.length) {
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const judgments = db().prepare(`
      SELECT j.* FROM judgments j
      WHERE j.id IN (
        SELECT id FROM judgments
        WHERE generation_id IN (${placeholders}) AND source = 'user'
        GROUP BY generation_id
        HAVING MAX(created_at)
      )
    `).all(...ids);
    const byGen = new Map(judgments.map(j => [j.generation_id, j]));
    for (const r of rows) {
      const j = byGen.get(r.id);
      if (j) r.userJudgment = { rating: j.rating, reasoning: j.reasoning, ts: j.created_at };
    }
  }

  res.json({ items: rows, nextCursor: rows.length ? rows[rows.length - 1].createdAt : null });
});

// ── ONE ──
generationsRouter.get('/generations/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM generations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const g = rowToGeneration(row);
  g.judgments = db().prepare('SELECT * FROM judgments WHERE generation_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(g);
});

// ── PATCH visibility / starred / notes ──
generationsRouter.patch('/generations/:id', (req, res) => {
  const { visibility, starred, notes } = req.body || {};
  const sets = [];
  const params = { id: req.params.id };
  if (visibility !== undefined) {
    if (!['visible', 'hidden'].includes(visibility))
      return res.status(400).json({ error: 'invalid visibility' });
    sets.push('visibility = @visibility'); params.visibility = visibility;
  }
  if (starred !== undefined)  { sets.push('starred = @starred'); params.starred = starred ? 1 : 0; }
  if (notes !== undefined)    { sets.push('notes = @notes');     params.notes = notes; }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });

  const info = db().prepare(`UPDATE generations SET ${sets.join(', ')} WHERE id = @id`).run(params);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  const row = db().prepare('SELECT * FROM generations WHERE id = ?').get(req.params.id);
  res.json(rowToGeneration(row));
});

// ── STANDALONE GENERATION (one-shot) ──
generationsRouter.post('/generations/standalone', async (req, res) => {
  try {
    const { prompt, refIds = [], provider: providerName, goal = null } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const provider = resolveProvider({ kind: 'image', name: providerName });
    const id = ulid();
    const startTs = Date.now();
    const out = await provider.generate({ prompt, refs: refIds });

    const ext = (out.mime === 'image/jpeg') ? 'jpg' : 'png';
    const { abs, rel } = bucketedPath(paths.generations, id, ext, startTs);
    atomicWriteSync(abs, out.bytes);

    db().prepare(`
      INSERT INTO generations
        (id, created_at, prompt, prompt_hash, ref_ids_json, provider, model,
         width, height, file_path, goal)
      VALUES (@id, @ts, @prompt, @hash, @refs, @prov, @model, @w, @h, @path, @goal)
    `).run({
      id, ts: startTs, prompt, hash: promptHash(prompt, refIds),
      refs: JSON.stringify(refIds), prov: provider.name, model: provider.model,
      w: out.width, h: out.height, path: rel, goal,
    });

    const row = db().prepare('SELECT * FROM generations WHERE id = ?').get(id);
    res.json(rowToGeneration(row));
  } catch (e) {
    console.error('[standalone]', e);
    res.status(500).json({ error: e.message });
  }
});

function rowToGeneration(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    parentId: row.parent_id,
    chainRunId: row.chain_run_id,
    iteration: row.iteration,
    goal: row.goal,
    prompt: row.prompt,
    refIds: JSON.parse(row.ref_ids_json),
    provider: row.provider,
    model: row.model,
    width: row.width,
    height: row.height,
    imageUrl: `/lab-assets/generations/${(row.file_path || '').replace(/\\/g, '/')}`,
    thumbUrl: row.thumb_path ? `/lab-assets/generations/${row.thumb_path.replace(/\\/g, '/')}` : null,
    score: row.score,
    visibility: row.visibility,
    starred: !!row.starred,
    notes: row.notes,
  };
}
