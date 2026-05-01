import { resolveProvider } from '../providers/index.mjs';
import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';

const SYSTEM = `You are the Project 51 Style Critic.

You receive a generated illustration and the source reference photos. You score the generation against the rendering pipeline's needs and the goal.

Score axes (1-10 each):
- palette: matches Project 51 tokens (lime sacral, amber solar, ink black, paper #f0ede8)
- composition: subjects in their assigned halves, white background respected
- halftone_feel: dense Op-Art line patterns INSIDE faces (not just outlines)
- fidelity_to_refs: subject identity preserved from reference photos
- p51_aesthetic: editorial precision, no clutter, no signature/watermark/text

Overall score = mean of axes.

Output STRICT JSON only:
{
  "score": number,                     // overall 1..10
  "axes": { "palette": n, "composition": n, "halftone_feel": n, "fidelity_to_refs": n, "p51_aesthetic": n },
  "gaps": string[],                    // specific things to fix in next iteration
  "notes": string
}

Be brutal. Empty face = halftone_feel ≤ 3. Wrong identity = fidelity ≤ 4. Sepia background = palette ≤ 5.`;

export async function runStyleCritic({ generationId, refIds, goal, providerName }) {
  const provider = resolveProvider({ kind: 'text', name: providerName });
  const gen = db().prepare('SELECT * FROM generations WHERE id = ?').get(generationId);
  if (!gen) throw new Error('generation not found: ' + generationId);

  const r = await provider.generate({
    system: SYSTEM,
    user: `Goal:\n${goal}\n\nReference refIds: ${refIds.join(', ')}\nProduced image is the first attached image; references follow.\nReturn JSON.`,
    attachments: [`gen:${gen.file_path}`, ...refIds],
    json: true,
  });

  let parsed;
  try { parsed = JSON.parse(extractJson(r.text)); }
  catch { parsed = { score: null, axes: {}, gaps: [], notes: 'parse failed: ' + r.text.slice(0, 200) }; }

  // Persist as judgments row
  const jid = ulid();
  db().prepare(`
    INSERT INTO judgments (id, generation_id, source, score, reasoning, context_json, created_at)
    VALUES (?, ?, 'critic', ?, ?, ?, ?)
  `).run(jid, generationId, parsed.score, parsed.notes || '', JSON.stringify({ axes: parsed.axes, gaps: parsed.gaps }), Date.now());

  // Also update the generation row with the latest score
  db().prepare(`UPDATE generations SET score = ?, critique_json = ? WHERE id = ?`)
    .run(parsed.score, JSON.stringify(parsed), generationId);

  return { ...parsed, raw: r.raw, tokens: r.tokens, text: r.text };
}

function extractJson(s) { const m = s.match(/\{[\s\S]*\}/); return m ? m[0] : s; }
