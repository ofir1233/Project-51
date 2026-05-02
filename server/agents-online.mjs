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

const WRITER_SYSTEM = `You write image-generation prompts for a Three.js point-cloud renderer.

CRITICAL: the renderer treats bright (>~92% luminance) pixels as background and SKIPS them. Pure-white backgrounds, blown-out highlights, or flat light scenes produce empty point clouds. Prompts must yield images with:
- Strong contrast and rich mid-to-dark tones
- Cinematic, directional lighting (chiaroscuro, low-key)
- Textured / detailed compositions (rough surfaces, fabric, fur, foliage)
- NO white background — instead use deep colored backgrounds, shadow, or environmental context
- Single clear subject taking up most of the frame, dramatic silhouette

Output STRICT JSON, nothing else:
{ "prompt": "<the rich image prompt>", "negative": "<what to avoid, or null>" }`;

const REFINER_SYSTEM = `You revise image-generation prompts based on a critic's feedback.
Same constraints as the writer (point-cloud renderer needs dark/contrasty images, no white backgrounds, cinematic lighting).
Address the critic's gaps directly. Output STRICT JSON: { "prompt": "<revised prompt>", "negative": "<...or null>" }`;

const CRITIC_SYSTEM = `You are a vision critic for a point-cloud image generator.

Score the produced image 1-10 on three axes:
- relevance       : how well the image matches the user's goal
- pointcloud_fit  : how visible it will be when rendered as a point cloud (the renderer keeps only non-bright pixels — score LOW if the image is mostly white/bright/flat, HIGH if it has rich darks, contrast, and textured detail)
- visual_interest : composition, lighting, detail, drama

Overall score = mean of the three.

Output STRICT JSON only:
{
  "score": <0-10>,
  "axes": { "relevance": n, "pointcloud_fit": n, "visual_interest": n },
  "gaps": [ "<short, actionable thing to fix>", ... ],
  "notes": "<one-line summary>"
}

Be honest. Mostly-white image → pointcloud_fit ≤ 3. Off-topic → relevance ≤ 4.`;

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
