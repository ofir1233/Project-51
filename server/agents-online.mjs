// Online-Lab agents. General-purpose (not tuned to the local Lab's
// halftone-portrait aesthetic). Each call hits Gemini text; image
// generation is the responsibility of util/generate.mjs.
//
//   writePrompt({ goal })
//     Expands a brief user idea into a rich image prompt geared toward
//     the point-cloud renderer (favors darker compositions, strong
//     contrast, avoids pure-white backgrounds since white pixels get
//     culled at render time).
//
//   refinePrompt({ goal, previousPrompt, gaps })
//     Same role as writePrompt but conditioned on the critic's notes
//     from a previous iteration.
//
//   critiqueImage({ goal, imageBytes, mime })
//     Vision-LLM call. Scores the generated image on relevance,
//     pointcloud-suitability, visual interest. Returns score + gaps.

import { resolveProvider } from './providers/index.mjs';

// Writer (no ref attached): one-shot formula geared to the point-cloud
// renderer (culls pixels >98% luminance, so dark/contrasty wins).
const WRITER_SYSTEM = `You write image-gen prompts for a point-cloud renderer that culls pixels brighter than ~98% luminance. Your job: write ONE image prompt that yields a photorealistic, high-contrast, dramatically-lit image whose subject fills the frame against a dark or richly-colored backdrop — never white.

Formula: "<subject doing X>, <directional lighting cue e.g. rim light / chiaroscuro / golden hour>, <deep colored backdrop e.g. dark teal void / charcoal stone wall / midnight forest>, <texture/detail cue>, cinematic, photorealistic, ultra-detailed, 8K".

Keep the prompt under 60 words. Single sentence preferred.

Output STRICT JSON only: {"prompt":"...","negative":"blurry, watermark, white background, flat lighting"}`;

// Writer (REF MODE): you can SEE the reference. Faithfully describe what's
// already there, apply only the user's modifications, and tell the model to
// preserve identity. Do NOT invent a different scene.
const WRITER_REF_SYSTEM = `You are looking at a REFERENCE IMAGE (attached). Your job: write ONE image-gen prompt for an image-to-image model that REPRODUCES the reference faithfully, applying only the user's stated modification (if any).

Step 1 — observe the reference: subjects (faces, identities, clothing, pose), composition, art style (e.g. photorealistic, halftone line-art, painted), lighting, color palette, background.
Step 2 — write a prompt that describes ALL of those preservation cues explicitly, then appends the user's modification.
Step 3 — always include phrases like: "preserve the subjects' faces and identities exactly", "preserve the composition", "match the art style of the reference".

If the user's "goal" is generic ("create this image", "make this", or just descriptive of what's already there), treat it as "reproduce the reference faithfully" — do not invent.

Do NOT add chiaroscuro / dark backdrop / cinematic if the reference doesn't have them — the goal is fidelity to the ref, not the renderer's preferred aesthetic. (Renderer can handle bright reference images thanks to a cutoff of 0.98.)

Keep prompt under 100 words. Output STRICT JSON only: {"prompt":"...","negative":"blurry, watermark, distorted faces"}`;

const REFINER_SYSTEM = `Revise the previous image-gen prompt to address the critic's gaps. Same hard rules as the writer (no white background, dramatic lighting, dark/colored backdrop, under 60 words). Output STRICT JSON: {"prompt":"...","negative":"..."}`;

const REFINER_REF_SYSTEM = `Revise the previous image-gen prompt to address the critic's gaps WITHOUT losing fidelity to the reference image. Keep the preservation cues (faces, composition, style). Apply only the gaps that don't conflict with the ref. Output STRICT JSON: {"prompt":"...","negative":"..."}`;

const CRITIC_SYSTEM = `Score the attached image as a point-cloud source. The renderer culls pixels >98% luminance, so flat/bright images render poorly.

Calibration:
  9-10 = great (relevant, lots of dark/mid tones, dramatic light)
  7-8  = good (clearly relevant, enough darks to render, decent composition) — DEFAULT for any reasonable result
  5-6  = mediocre (drifted from goal, OR mostly bright, OR flat lighting)
  1-4  = bad (off-topic OR almost all white/blown-out)

Be calibrated, not harsh — most decent images should score 7+. Only score below 7 if there's a real issue.

Output STRICT JSON: {"score":<0-10>,"axes":{"relevance":n,"pointcloud_fit":n,"visual_interest":n},"gaps":["one-line fix",...],"notes":"<one line>"}`;

function extractJson(s) {
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : s;
}

async function callText({ system, user, attachments, providerName = 'gemini-text', abortSignal }) {
  const provider = resolveProvider({ kind: 'text', name: providerName });
  const r = await provider.generate({ system, user, attachments, json: true, abortSignal });
  let parsed;
  try { parsed = JSON.parse(extractJson(r.text)); }
  catch { parsed = { _parseError: true, _raw: r.text }; }
  return { parsed, tokens: r.tokens };
}

export async function writePrompt({ goal, refBytes = [], abortSignal }) {
  const hasRef = refBytes.length > 0;
  const { parsed, tokens } = await callText({
    system: hasRef ? WRITER_REF_SYSTEM : WRITER_SYSTEM,
    user: hasRef
      ? `User instruction: ${goal}\n\nThe attached image is the reference. Write a prompt that reproduces it faithfully, applying only the user's modification (if any). Return JSON.`
      : `Goal: ${goal}\n\nReturn JSON.`,
    attachments: hasRef ? refBytes : undefined,
    abortSignal,
  });
  return {
    prompt:   parsed.prompt   || goal,
    negative: parsed.negative || null,
    tokens,
  };
}

export async function refinePrompt({ goal, previousPrompt, gaps, refBytes = [], abortSignal }) {
  const hasRef = refBytes.length > 0;
  const gapStr = (gaps || []).map(g => '- ' + g).join('\n') || '- (no specific gaps)';
  const { parsed, tokens } = await callText({
    system: hasRef ? REFINER_REF_SYSTEM : REFINER_SYSTEM,
    user: `User instruction: ${goal}\n\nPrevious prompt:\n${previousPrompt}\n\nCritic gaps:\n${gapStr}\n\nReturn JSON.`,
    attachments: hasRef ? refBytes : undefined,
    abortSignal,
  });
  return {
    prompt:   parsed.prompt   || previousPrompt,
    negative: parsed.negative || null,
    tokens,
  };
}

export async function critiqueImage({ goal, imageBytes, mime = 'image/png', abortSignal }) {
  // gemini-text supports inline image attachments via Buffer.
  const { parsed, tokens } = await callText({
    system: CRITIC_SYSTEM,
    user:   `User goal: ${goal}\n\nThe attached image is the produced result. Return JSON.`,
    attachments: [imageBytes],
    abortSignal,
  });
  const score = typeof parsed.score === 'number' ? parsed.score : 0;
  return {
    score,
    axes:  parsed.axes  || {},
    gaps:  Array.isArray(parsed.gaps) ? parsed.gaps : [],
    notes: parsed.notes || '',
    tokens,
  };
}
