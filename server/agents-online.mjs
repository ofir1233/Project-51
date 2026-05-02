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

// Writer formula (one-shot, must work first try most of the time):
//   <subject>, <action/pose>, <dramatic lighting cue>, <dark/colored backdrop>,
//   <texture/detail cue>, <art-style cue>, cinematic, photorealistic, ultra-detailed
// Hard rule: NEVER white background (renderer culls bright pixels).
const WRITER_SYSTEM = `You write image-gen prompts for a point-cloud renderer that culls pixels brighter than ~98% luminance. Your job: write ONE image prompt that yields a photorealistic, high-contrast, dramatically-lit image whose subject fills the frame against a dark or richly-colored backdrop — never white.

Formula: "<subject doing X>, <directional lighting cue e.g. rim light / chiaroscuro / golden hour>, <deep colored backdrop e.g. dark teal void / charcoal stone wall / midnight forest>, <texture/detail cue>, cinematic, photorealistic, ultra-detailed, 8K".

Keep the prompt under 60 words. Single sentence preferred.

Output STRICT JSON only: {"prompt":"...","negative":"blurry, watermark, white background, flat lighting"}`;

const REFINER_SYSTEM = `Revise the previous image-gen prompt to address the critic's gaps. Same hard rules as the writer (no white background, dramatic lighting, dark/colored backdrop, under 60 words). Output STRICT JSON: {"prompt":"...","negative":"..."}`;

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

export async function writePrompt({ goal, abortSignal }) {
  const { parsed, tokens } = await callText({
    system: WRITER_SYSTEM,
    user: `Goal: ${goal}\n\nReturn JSON.`,
    abortSignal,
  });
  return {
    prompt:   parsed.prompt   || goal,
    negative: parsed.negative || null,
    tokens,
  };
}

export async function refinePrompt({ goal, previousPrompt, gaps, abortSignal }) {
  const gapStr = (gaps || []).map(g => '- ' + g).join('\n') || '- (no specific gaps)';
  const { parsed, tokens } = await callText({
    system: REFINER_SYSTEM,
    user: `Goal: ${goal}\n\nPrevious prompt:\n${previousPrompt}\n\nCritic gaps:\n${gapStr}\n\nReturn JSON.`,
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
