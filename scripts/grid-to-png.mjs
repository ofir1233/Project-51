// One-shot helper. Reads a Supabase scene-grid JSON dump from /tmp/scene.json
// and writes a grayscale PNG that the synthesis.html portrait renderer
// (which expects bright = subject, dark = background) can consume directly.
//
// The lab grid stores raw luminance (0=dark, 255=bright) of the source
// image. Whether to invert depends on the source: photographic portrait on
// dark background → don't invert; line-art on light background → invert so
// the strokes are bright. Pass "--invert" on the command line.
//
//   node scripts/grid-to-png.mjs <out.png> [--invert]

import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const out = process.argv[2];
const invert = process.argv.includes('--invert');
if (!out) { console.error('usage: node scripts/grid-to-png.mjs <out.png> [--invert]'); process.exit(1); }

// On Windows, MSYS's /tmp maps to %LOCALAPPDATA%\Temp. Resolve via env.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const inputPath = process.env.SCENE_JSON || join(tmpdir(), 'scene.json');
const rows = JSON.parse(readFileSync(inputPath, 'utf8'));
const row = rows[0];
const w = row.grid_w;
const h = row.grid_h;
const lum = row.point_grid.lum;
if (!Array.isArray(lum) || lum.length !== w * h) {
  console.error('grid mismatch', { w, h, len: lum?.length });
  process.exit(1);
}

const buf = Buffer.alloc(w * h);
for (let i = 0; i < w * h; i++) buf[i] = invert ? (255 - lum[i]) : lum[i];

await sharp(buf, { raw: { width: w, height: h, channels: 1 } })
  .png()
  .toFile(out);

console.log(`wrote ${out} (${w}×${h}, invert=${invert})`);
