import { Router } from 'express';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import sharp from 'sharp';
import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';
import { atomicCopySync, atomicWriteSync } from '../util/files.mjs';
import { sha256File, sizeOf } from '../util/hash.mjs';
import { paths } from '../paths.mjs';

export const approvalsRouter = Router();

approvalsRouter.get('/approvals', (req, res) => {
  const slot = req.query.slot;
  const items = slot
    ? db().prepare('SELECT * FROM approvals WHERE slot = ? ORDER BY created_at DESC LIMIT 100').all(slot)
    : db().prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100').all();
  res.json({ items });
});

approvalsRouter.post('/approvals', async (req, res) => {
  const { generationId, slot } = req.body || {};
  if (!generationId || !slot) return res.status(400).json({ error: 'generationId+slot required' });
  const gen = db().prepare('SELECT * FROM generations WHERE id = ?').get(generationId);
  if (!gen) return res.status(404).json({ error: 'generation not found' });
  const liveAbs = join(paths.liveAssetsDir, slot);
  const genAbs = join(paths.generations, gen.file_path);
  if (!existsSync(genAbs)) return res.status(404).json({ error: 'generation file missing' });

  const liveExt = slot.toLowerCase().split('.').pop();
  const genExt = gen.file_path.toLowerCase().split('.').pop();

  // If extensions differ, convert via sharp once outside the transaction so
  // the transaction stays fast (only file ops + DB).
  let sourceForSwap = genAbs;
  if (liveExt !== genExt) {
    try {
      const buf = readFileSync(genAbs);
      const out = await sharp(buf, { failOn: 'none' })
        .toFormat(liveExt === 'jpg' || liveExt === 'jpeg' ? 'jpeg' : liveExt, { quality: 92 })
        .toBuffer();
      const tmpAbs = join(paths.tmp, `${ulid()}.${liveExt}`);
      atomicWriteSync(tmpAbs, out);
      sourceForSwap = tmpAbs;
    } catch (e) {
      return res.status(500).json({ error: `format conversion failed (${genExt}→${liveExt}): ${e.message}` });
    }
  }

  const txn = db().transaction(() => {
    // 1. snapshot current live
    let snapshotId = null;
    if (existsSync(liveAbs)) {
      snapshotId = ulid();
      const archDir = join(paths.snapshots, snapshotId);
      mkdirSync(archDir, { recursive: true });
      const newArch = join(archDir, basename(slot));
      atomicCopySync(liveAbs, newArch);
      db().prepare(`
        INSERT INTO snapshots (id, created_at, reason, slot, live_rel_path, archive_path, sha256, size_bytes, note)
        VALUES (?, ?, 'pre-swap', ?, ?, ?, ?, ?, ?)
      `).run(snapshotId, Date.now(), slot, `p51/assets/${slot}`, `${snapshotId}/${basename(slot)}`,
        sha256File(newArch), sizeOf(newArch), `pre-swap before approving ${generationId}`);
    } else {
      // No live yet — create a placeholder snapshot pointing nowhere (rare)
      snapshotId = ulid();
      db().prepare(`
        INSERT INTO snapshots (id, created_at, reason, slot, live_rel_path, archive_path, sha256, size_bytes, note)
        VALUES (?, ?, 'pre-swap', ?, ?, ?, ?, ?, ?)
      `).run(snapshotId, Date.now(), slot, `p51/assets/${slot}`, ``, '', 0, 'no live file at swap time');
    }

    // 2. atomic copy generation (or converted variant) → live slot
    atomicCopySync(sourceForSwap, liveAbs);

    // 3. mark previous active approval inactive
    db().prepare(`UPDATE approvals SET active = 0 WHERE slot = ? AND active = 1`).run(slot);

    // 4. insert new active approval
    const aid = ulid();
    db().prepare(`
      INSERT INTO approvals (id, created_at, generation_id, slot, snapshot_id, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(aid, Date.now(), generationId, slot, snapshotId);
    return { aid, snapshotId };
  });

  try {
    const { aid, snapshotId } = txn();
    const approval = db().prepare('SELECT * FROM approvals WHERE id = ?').get(aid);
    const snapshot = db().prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId);
    res.json({ approval, snapshot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

approvalsRouter.post('/approvals/:id/revert', (req, res) => {
  const ap = db().prepare('SELECT * FROM approvals WHERE id = ?').get(req.params.id);
  if (!ap) return res.status(404).json({ error: 'not found' });
  const snap = db().prepare('SELECT * FROM snapshots WHERE id = ?').get(ap.snapshot_id);
  if (!snap) return res.status(404).json({ error: 'snapshot missing' });
  const archAbs = join(paths.snapshots, snap.archive_path);
  const liveAbs = join(paths.liveAssetsDir, snap.slot);
  if (!existsSync(archAbs)) return res.status(404).json({ error: 'archive missing' });
  atomicCopySync(archAbs, liveAbs);
  db().prepare(`UPDATE approvals SET active = 0 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, reverted: ap.id });
});
