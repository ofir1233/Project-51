// Deterministic test PNG generator — no external deps.
// Produces a colored rectangle whose hue is derived from the prompt hash,
// so different prompts yield visibly different images. The point is to test
// the pipeline (history, preview, snapshot, approve) without burning API calls.

import { deflateSync } from 'node:zlib';
import { sha256Buffer } from '../util/hash.mjs';

const SIZE = 512;

export const stubImage = {
  kind: 'image',
  name: 'stub-image',
  model: 'stub',
  ready: true,

  async generate({ prompt, refs = [], abortSignal }) {
    if (abortSignal?.aborted) throw new Error('aborted');
    const hash = sha256Buffer(Buffer.from(prompt + ':' + (refs[0] || '')));
    // hue from first byte, lightness from second
    const hue = hash.charCodeAt(0) * 360 / 255;
    const sat = 60 + (hash.charCodeAt(1) % 40);
    const light = 30 + (hash.charCodeAt(2) % 30);
    const [r, g, b] = hslToRgb(hue / 360, sat / 100, light / 100);
    const png = makePngSolid(SIZE, SIZE, r, g, b, prompt.slice(0, 80));
    return {
      bytes: png,
      mime: 'image/png',
      width: SIZE,
      height: SIZE,
      raw: { stub: true, hue, sat, light },
      tokens: { prompt: 0, output: 0, total: 0 },
    };
  },
};

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Minimal PNG encoder: solid color + a 4×6 ASCII strip with the prompt label.
function makePngSolid(w, h, r, g, b, label = '') {
  // raw image: filter byte 0 + RGB pixels
  const rowSize = 1 + w * 3;
  const raw = Buffer.alloc(rowSize * h);
  for (let y = 0; y < h; y++) {
    const off = y * rowSize;
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const i = off + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }

  // overlay tiny ASCII label (5×7 dot font, very legible at any size)
  drawLabel(raw, rowSize, w, h, label);

  // PNG file structure
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk('IHDR', Buffer.concat([
    u32(w), u32(h),
    Buffer.from([8, 2, 0, 0, 0]), // 8-bit, RGB
  ]));
  const idat = chunk('IDAT', deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }

function chunk(type, data) {
  const len = u32(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = u32(crc32(crcInput));
  return Buffer.concat([len, typeBuf, data, crc]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

// 5×7 dot font for ASCII 32-126, rendered as 8× scale
const FONT = {
  // each glyph is 5 rows × 5 cols, packed bottom-up. 1=ink.
  ' ': '00000 00000 00000 00000 00000',
  '·': '00000 00000 00100 00000 00000',
  '.': '00000 00000 00000 00000 00100',
  ',': '00000 00000 00000 00100 01000',
  '-': '00000 00000 11111 00000 00000',
  ':': '00000 01000 00000 01000 00000',
  '/': '00001 00010 00100 01000 10000',
};
function drawLabel(raw, rowSize, w, h, label) {
  const scale = 4;
  const charW = 5 * scale + scale;
  const charH = 5 * scale;
  const x0 = 16;
  const y0 = h - charH - 16;
  for (let i = 0; i < label.length; i++) {
    const ch = label[i].toUpperCase();
    const glyph = FONT[ch] || charGlyph(ch);
    if (!glyph) continue;
    const rows = glyph.split(' ');
    for (let ry = 0; ry < 5; ry++) {
      for (let rx = 0; rx < 5; rx++) {
        if (rows[ry][rx] === '1') {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = x0 + i * charW + rx * scale + dx;
              const py = y0 + ry * scale + dy;
              if (px < 0 || px >= w || py < 0 || py >= h) continue;
              const off = py * rowSize + 1 + px * 3;
              raw[off] = 240; raw[off + 1] = 237; raw[off + 2] = 232; // p51-white
            }
          }
        }
      }
    }
  }
}
// Letters/digits: cheap auto-glyphs (vertical line + diagonal strokes per char hash)
function charGlyph(ch) {
  if (FONT[ch]) return FONT[ch];
  // generic block to indicate "some char"
  return '11111 10001 10001 10001 11111';
}
