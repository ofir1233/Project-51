import { resolveProvider } from '../providers/index.mjs';
import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';

const SYSTEM = `You are the Project 51 Element Detector.

You receive a halftone illustration. Identify the COARSE structural elements (3-8 total). Use semantic labels — never pixel descriptions.

Examples of good labels: "face left", "face right", "torso left", "torso right", "building", "crowd", "background pattern", "object · key", "object · table".

Output STRICT JSON only:
{
  "elements": [
    { "label": string, "bbox": [x, y, w, h], "confidence": number }
  ]
}

Bbox is normalized 0..1 floats:
- x, y = top-left corner
- w, h = width, height
- All four values must be 0..1 (the image is the unit square)

Confidence is 0..1. Order elements by importance (main subjects first). Never more than 8 elements.`;

export async function runElementDetector({ generationId, providerName }) {
  const provider = resolveProvider({ kind: 'text', name: providerName });
  const gen = db().prepare('SELECT * FROM generations WHERE id = ?').get(generationId);
  if (!gen) throw new Error('generation not found: ' + generationId);

  const r = await provider.generate({
    system: SYSTEM,
    user: `Analyze this image and return the element list as JSON.`,
    attachments: [`gen:${gen.file_path}`],
    json: true,
  });

  let parsed;
  try { parsed = JSON.parse(extractJson(r.text)); }
  catch { parsed = { elements: [] }; }

  const ts = Date.now();
  const insert = db().prepare(`
    INSERT INTO element_detections (id, generation_id, label, bbox_x, bbox_y, bbox_w, bbox_h, confidence, manual, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const txn = db().transaction(() => {
    // Replace any existing auto-detections for this generation
    db().prepare(`DELETE FROM element_detections WHERE generation_id = ? AND manual = 0`).run(generationId);
    for (const e of (parsed.elements || []).slice(0, 8)) {
      const [x, y, w, h] = e.bbox || [0, 0, 0, 0];
      if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) continue;
      insert.run(ulid(), generationId, e.label || 'element',
        clamp01(x), clamp01(y), clamp01(w), clamp01(h),
        Number.isFinite(+e.confidence) ? +e.confidence : null,
        ts);
    }
  });
  txn();

  const rows = db().prepare(`SELECT * FROM element_detections WHERE generation_id = ? ORDER BY created_at`).all(generationId);
  return { elements: rows, raw: r.raw, tokens: r.tokens };
}

function clamp01(n) { n = +n; if (!isFinite(n)) return 0; return Math.max(0, Math.min(1, n)); }
function extractJson(s) { const m = s.match(/\{[\s\S]*\}/); return m ? m[0] : s; }
