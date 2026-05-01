import { Router } from 'express';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';
import { atomicCopySync } from '../util/files.mjs';
import { sha256File, sizeOf } from '../util/hash.mjs';
import { paths } from '../paths.mjs';

export const snapshotsRouter = Router();

snapshotsRouter.get('/snapshots', (req, res) => {
  const slot = req.query.slot;
  const sql = slot
    ? `SELECT * FROM snapshots WHERE slot = ? ORDER BY created_at DESC LIMIT 200`
    : `SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 200`;
  const items = slot ? db().prepare(sql).all(slot) : db().prepare(sql).all();
  res.json({ items });
});

snapshotsRouter.post('/snapshots', (req, res) => {
  const { slot, note = null } = req.body || {};
  if (!slot) return res.status(400).json({ error: 'slot required' });
  const livePath = join(paths.liveAssetsDir, slot);
  if (!existsSync(livePath)) return res.status(404).json({ error: 'live slot not found: ' + slot });

  const sid = ulid();
  const archDir = join(paths.snapshots, sid);
  mkdirSync(archDir, { recursive: true });
  const archPath = join(archDir, basename(slot));
  atomicCopySync(livePath, archPath);

  db().prepare(`
    INSERT INTO snapshots (id, created_at, reason, slot, live_rel_path, archive_path, sha256, size_bytes, note)
    VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?)
  `).run(sid, Date.now(), slot, `p51/assets/${slot}`, `${sid}/${basename(slot)}`, sha256File(archPath), sizeOf(archPath), note);

  const row = db().prepare('SELECT * FROM snapshots WHERE id = ?').get(sid);
  res.json(row);
});

snapshotsRouter.post('/snapshots/:id/restore', (req, res) => {
  const snap = db().prepare('SELECT * FROM snapshots WHERE id = ?').get(req.params.id);
  if (!snap) return res.status(404).json({ error: 'not found' });
  const archAbs = join(paths.snapshots, snap.archive_path);
  if (!existsSync(archAbs)) return res.status(404).json({ error: 'archive missing' });

  // First snapshot the CURRENT live file (so restore is reversible)
  const liveAbs = join(paths.liveAssetsDir, snap.slot);
  if (existsSync(liveAbs)) {
    const sid = ulid();
    const archDir = join(paths.snapshots, sid);
    mkdirSync(archDir, { recursive: true });
    const newArch = join(archDir, basename(snap.slot));
    atomicCopySync(liveAbs, newArch);
    db().prepare(`
      INSERT INTO snapshots (id, created_at, reason, slot, live_rel_path, archive_path, sha256, size_bytes, note)
      VALUES (?, ?, 'pre-restore', ?, ?, ?, ?, ?, ?)
    `).run(sid, Date.now(), snap.slot, `p51/assets/${snap.slot}`, `${sid}/${basename(snap.slot)}`,
      sha256File(newArch), sizeOf(newArch), `taken before restoring ${snap.id}`);
  }

  // Now copy archive → live
  atomicCopySync(archAbs, liveAbs);

  // Mark the original snap's approval (if any) inactive and don't auto-create a new approval
  res.json({ ok: true, restored: snap.id });
});
