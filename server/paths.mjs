import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const LAB_ROOT  = join(REPO_ROOT, '.lab');

export const paths = Object.freeze({
  repoRoot:      REPO_ROOT,
  publicDir:     REPO_ROOT,
  p51Dir:        join(REPO_ROOT, 'p51'),
  liveAssetsDir: join(REPO_ROOT, 'p51', 'assets'),
  labRoot:       LAB_ROOT,
  envFile:       join(LAB_ROOT, '.env'),
  dbFile:        join(LAB_ROOT, 'lab.db'),
  generations:   join(LAB_ROOT, 'generations'),
  snapshots:     join(LAB_ROOT, 'snapshots'),
  refs:          join(LAB_ROOT, 'refs'),
  logs:          join(LAB_ROOT, 'logs'),
  tmp:           join(LAB_ROOT, 'tmp'),
});

export function ensureDirs() {
  for (const key of ['labRoot', 'generations', 'snapshots', 'refs', 'logs', 'tmp']) {
    if (!existsSync(paths[key])) mkdirSync(paths[key], { recursive: true });
  }
}
