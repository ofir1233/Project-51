import { Router } from 'express';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { paths } from '../paths.mjs';
import { atomicWriteSync } from '../util/files.mjs';
import { sha256Buffer } from '../util/hash.mjs';

export const refsRouter = Router();

// List ONLY user-uploaded refs (live site assets are not refs).
refsRouter.get('/refs', (req, res) => {
  const items = [];
  try {
    for (const f of readdirSync(paths.refs)) {
      if (!/\.(jpe?g|png|webp)$/i.test(f)) continue;
      const abs = join(paths.refs, f);
      const st = statSync(abs);
      items.push({
        id: `ref:${f}`,
        kind: 'ref',
        name: f,
        url: `/lab-assets/refs/${encodeURIComponent(f)}`,
        size: st.size,
        mtime: st.mtimeMs,
      });
    }
  } catch {}
  res.json({ items });
});

// Upload one ref via base64 JSON — no multipart parser needed.
// Body: { name?: string, base64: string, mime?: string }
refsRouter.post('/refs', (req, res) => {
  const { name, base64, mime } = req.body || {};
  if (!base64 || typeof base64 !== 'string')
    return res.status(400).json({ error: 'base64 required' });

  let buf;
  try {
    // strip data: prefix if present
    const data = base64.includes(',') ? base64.split(',')[1] : base64;
    buf = Buffer.from(data, 'base64');
  } catch {
    return res.status(400).json({ error: 'invalid base64' });
  }
  if (buf.length < 32) return res.status(400).json({ error: 'too small' });

  // Sanitize filename, keep extension
  const inferredExt = (() => {
    if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
    if (buf[0] === 0x52 && buf[1] === 0x49) return '.webp';
    return '.bin';
  })();
  const safeName = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  const baseName = safeName ? safeName.replace(/\.[^.]+$/, '') : sha256Buffer(buf).slice(0, 12);
  const ext = safeName && /\.(jpe?g|png|webp)$/i.test(safeName)
    ? extname(safeName).toLowerCase()
    : inferredExt;
  const filename = `${baseName}${ext}`;
  const abs = join(paths.refs, filename);

  atomicWriteSync(abs, buf);
  const st = statSync(abs);
  res.json({
    id: `ref:${filename}`,
    kind: 'ref',
    name: filename,
    url: `/lab-assets/refs/${encodeURIComponent(filename)}`,
    size: st.size,
    mtime: st.mtimeMs,
  });
});

refsRouter.delete('/refs/:name', (req, res) => {
  const safeName = (req.params.name || '').replace(/[^a-z0-9._-]/gi, '');
  if (!safeName) return res.status(400).json({ error: 'invalid name' });
  const abs = join(paths.refs, safeName);
  try { unlinkSync(abs); res.json({ ok: true }); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
