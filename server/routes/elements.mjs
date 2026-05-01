import { Router } from 'express';
import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';
import { runElementDetector } from '../agents/element-detector.mjs';
import { config } from '../config.mjs';

export const elementsRouter = Router();

elementsRouter.get('/elements', (req, res) => {
  const generationId = req.query.generationId;
  if (!generationId) return res.status(400).json({ error: 'generationId required' });
  const items = db().prepare(`SELECT * FROM element_detections WHERE generation_id = ? ORDER BY created_at`).all(generationId);
  res.json({ items });
});

elementsRouter.post('/elements/detect', async (req, res) => {
  const { generationId, provider } = req.body || {};
  if (!generationId) return res.status(400).json({ error: 'generationId required' });
  try {
    const r = await runElementDetector({ generationId, providerName: provider || config.defaultTextProvider });
    res.json({ elements: r.elements, tokens: r.tokens });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

elementsRouter.post('/elements', (req, res) => {
  const { generationId, label, bbox } = req.body || {};
  if (!generationId || !Array.isArray(bbox) || bbox.length !== 4)
    return res.status(400).json({ error: 'generationId + bbox[4] required' });
  const id = ulid();
  db().prepare(`
    INSERT INTO element_detections (id, generation_id, label, bbox_x, bbox_y, bbox_w, bbox_h, confidence, manual, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)
  `).run(id, generationId, label || 'manual', +bbox[0], +bbox[1], +bbox[2], +bbox[3], Date.now());
  const row = db().prepare('SELECT * FROM element_detections WHERE id = ?').get(id);
  res.json(row);
});

elementsRouter.delete('/elements/:id', (req, res) => {
  const info = db().prepare(`DELETE FROM element_detections WHERE id = ?`).run(req.params.id);
  res.json({ deleted: info.changes });
});

elementsRouter.delete('/elements', (req, res) => {
  const generationId = req.query.generationId;
  if (!generationId) return res.status(400).json({ error: 'generationId required' });
  const info = db().prepare(`DELETE FROM element_detections WHERE generation_id = ?`).run(generationId);
  res.json({ deleted: info.changes });
});

// Scene graph endpoints
elementsRouter.get('/scene-graphs/:generationId', (req, res) => {
  const row = db().prepare('SELECT * FROM scene_graphs WHERE generation_id = ?').get(req.params.generationId);
  if (!row) return res.json({ generationId: req.params.generationId, graph: null });
  res.json({ generationId: row.generation_id, graph: JSON.parse(row.graph_json), updatedAt: row.updated_at });
});

elementsRouter.put('/scene-graphs/:generationId', (req, res) => {
  const { graph } = req.body || {};
  if (!graph || typeof graph !== 'object') return res.status(400).json({ error: 'graph object required' });
  const gen = db().prepare('SELECT id FROM generations WHERE id = ?').get(req.params.generationId);
  if (!gen) return res.status(404).json({ error: 'generation not found: ' + req.params.generationId });
  db().prepare(`
    INSERT INTO scene_graphs (generation_id, graph_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(generation_id) DO UPDATE SET graph_json = excluded.graph_json, updated_at = excluded.updated_at
  `).run(req.params.generationId, JSON.stringify(graph), Date.now());
  res.json({ ok: true });
});
