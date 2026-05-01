import { writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { paths } from '../paths.mjs';
import { ulid } from './ids.mjs';

// Atomic write — write to .lab/tmp/, then rename into place.
// Caller passes ABSOLUTE final path.
export function atomicWriteSync(finalPath, bytes) {
  const dir = dirname(finalPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = join(paths.tmp, ulid() + '.tmp');
  writeFileSync(tmpPath, bytes);
  renameSync(tmpPath, finalPath);
  return finalPath;
}

// Atomic copy — copy to .lab/tmp/, rename into final.
export function atomicCopySync(src, dst) {
  const dir = dirname(dst);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = join(paths.tmp, ulid() + '.tmp');
  copyFileSync(src, tmpPath);
  renameSync(tmpPath, dst);
  return dst;
}

// Compute a date-bucketed path for a generation: 2026/05/01/<id>.png
export function bucketedPath(rootDir, id, ext = 'png', when = Date.now()) {
  const d = new Date(when);
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dir = join(rootDir, y, m, day);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return {
    abs: join(dir, `${id}.${ext}`),
    rel: `${y}/${m}/${day}/${id}.${ext}`,
  };
}

export { readFileSync };
