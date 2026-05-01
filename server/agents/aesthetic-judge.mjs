import { resolveProvider } from '../providers/index.mjs';
import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';

const SYSTEM_BASE = `You are the Project 51 Aesthetic Judge.

You sit at the END of the funnel. You receive a finalist generation and predict whether the user will accept it. You have a baseline rubric AND few-shot examples drawn from this user's prior good/bad labels. The few-shot examples are the strongest signal — pattern-match to them.

Baseline rubric (apply when no few-shot examples exist):
- Faces must be densely line-worked INSIDE the silhouette (Op-Art, not just outlines).
- Composition: subjects in correct halves, pure white background.
- Identity preserved against reference photos (no facial features that differ).
- Palette respects P51 tokens (lime sacral, amber solar, ink black, paper #f0ede8).
- No text, no signature, no border, no frame, no watermark.

Output STRICT JSON only:
{
  "rating": "good" | "bad" | "meh",
  "score": number,                   // 1..10 confidence-weighted
  "reasoning": string,               // 1-3 sentences referencing rubric items + few-shot patterns
  "matched_examples": string[]       // generation IDs of few-shot examples that drove the call
}`;

export async function runAestheticJudge({ generationId, refIds = [], k = 8, providerName }) {
  const provider = resolveProvider({ kind: 'text', name: providerName });
  const gen = db().prepare('SELECT * FROM generations WHERE id = ?').get(generationId);
  if (!gen) throw new Error('generation not found: ' + generationId);

  // Pull the user's k most recent labeled generations as few-shot context.
  const examples = db().prepare(`
    SELECT g.id, g.prompt, g.file_path, j.rating, j.reasoning
    FROM judgments j
    JOIN generations g ON g.id = j.generation_id
    WHERE j.source = 'user' AND j.rating IS NOT NULL
    ORDER BY j.created_at DESC
    LIMIT ?
  `).all(k);

  const fewShotText = examples.length
    ? examples.map((e, i) => `Example ${i+1} · rating=${e.rating}\nprompt: ${e.prompt.slice(0, 200)}\nuser notes: ${e.reasoning || '(none)'}\n`).join('\n')
    : '(no labeled examples yet — apply baseline rubric only)';

  const attachments = [`gen:${gen.file_path}`, ...refIds, ...examples.map(e => `gen:${e.file_path}`)];

  const r = await provider.generate({
    system: SYSTEM_BASE,
    user: `Generation under review (first attached image):\nprompt: ${gen.prompt.slice(0, 500)}\n\nFew-shot examples (next attached images, in order):\n${fewShotText}\n\nReturn JSON.`,
    attachments,
    json: true,
  });

  let parsed;
  try { parsed = JSON.parse(extractJson(r.text)); }
  catch { parsed = { rating: null, score: null, reasoning: 'parse failed: ' + r.text.slice(0, 200), matched_examples: [] }; }

  // Persist
  const jid = ulid();
  db().prepare(`
    INSERT INTO judgments (id, generation_id, source, rating, score, reasoning, context_json, created_at)
    VALUES (?, ?, 'judge', ?, ?, ?, ?, ?)
  `).run(jid, generationId, parsed.rating, parsed.score, parsed.reasoning, JSON.stringify({
    fewShotIds: examples.map(e => e.id),
    matchedExamples: parsed.matched_examples || [],
    model: r.raw?.model,
  }), Date.now());

  return { ...parsed, fewShotCount: examples.length, raw: r.raw, tokens: r.tokens, text: r.text };
}

function extractJson(s) { const m = s.match(/\{[\s\S]*\}/); return m ? m[0] : s; }
