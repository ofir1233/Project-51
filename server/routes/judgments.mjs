import { Router } from 'express';
import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';

export const judgmentsRouter = Router();

// LIST judgments — optionally filtered by generation, source, rating
judgmentsRouter.get('/judgments', (req, res) => {
  const where = [];
  const params = {};
  if (req.query.generationId) { where.push('generation_id = @gid'); params.gid = req.query.generationId; }
  if (req.query.source)       { where.push('source = @src');         params.src = req.query.source; }
  if (req.query.rating)       { where.push('rating = @r');           params.r = req.query.rating; }
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);

  const sql = `SELECT * FROM judgments
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT ${limit}`;
  res.json({ items: db().prepare(sql).all(params) });
});

// ADD a judgment — most commonly source='user' with rating + reasoning
judgmentsRouter.post('/judgments', (req, res) => {
  const { generationId, source = 'user', rating = null, score = null, reasoning = null } = req.body || {};
  if (!generationId) return res.status(400).json({ error: 'generationId required' });
  if (!['user', 'judge', 'critic'].includes(source))
    return res.status(400).json({ error: 'invalid source' });
  if (rating && !['good', 'bad', 'meh'].includes(rating))
    return res.status(400).json({ error: 'invalid rating' });

  const exists = db().prepare('SELECT id FROM generations WHERE id = ?').get(generationId);
  if (!exists) return res.status(404).json({ error: 'generation not found' });

  const id = ulid();
  db().prepare(`
    INSERT INTO judgments (id, generation_id, source, rating, score, reasoning, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, generationId, source, rating, score, reasoning, Date.now());

  const row = db().prepare('SELECT * FROM judgments WHERE id = ?').get(id);
  res.json(row);
});
