// Online chain: writePrompt → generate → critique → refine → repeat.
//
// Implemented as an async generator yielding progress events so the route
// handler can stream them to the browser. Stops when the critic's score
// passes the threshold or maxIterations is reached. Returns the best
// (highest-scored) image bytes.
//
//   for await (const ev of runChain({ goal })) { ... }
//
// Event shapes:
//   { type: 'step', step: '<name>', iteration: n }
//   { type: 'prompt', prompt, iteration }
//   { type: 'critique', score, gaps, iteration }
//   { type: 'done', bytes, mime, finalPrompt, score, iterations, model, provider }

import { writePrompt, refinePrompt, critiqueImage } from '../agents-online.mjs';
import { generateImage } from './generate.mjs';

export async function* runChain({
  goal,
  refBytes = [],
  maxIterations = 2,
  scoreThreshold = 6.5,
  abortSignal,
}) {
  let prompt = null;
  let lastImage = null;
  let lastCritique = null;
  let best = null; // { bytes, mime, prompt, score, iteration }
  const hasRef = refBytes.length > 0;

  for (let i = 1; i <= maxIterations; i++) {
    yield { type: 'step', step: i === 1 ? 'writing prompt' : `refining prompt (iteration ${i})`, iteration: i };

    if (i === 1) {
      const r = await writePrompt({ goal, hasRef, abortSignal });
      prompt = r.prompt;
    } else {
      const r = await refinePrompt({ goal, previousPrompt: prompt, gaps: lastCritique.gaps, hasRef, abortSignal });
      prompt = r.prompt;
    }
    yield { type: 'prompt', prompt, iteration: i };

    yield { type: 'step', step: 'generating image', iteration: i };
    const img = await generateImage({ prompt, refBytes, abortSignal });
    lastImage = img;

    yield { type: 'step', step: 'critiquing', iteration: i };
    const critique = await critiqueImage({ goal, imageBytes: img.bytes, mime: img.mime, abortSignal });
    lastCritique = critique;
    yield { type: 'critique', score: critique.score, gaps: critique.gaps, axes: critique.axes, iteration: i };

    if (!best || critique.score > best.score) {
      best = { bytes: img.bytes, mime: img.mime, prompt, score: critique.score, iteration: i, model: img.model, provider: img.provider };
    }
    if (critique.score >= scoreThreshold) break;
  }

  yield {
    type: 'done',
    bytes: best.bytes,
    mime: best.mime,
    finalPrompt: best.prompt,
    score: best.score,
    iterations: best.iteration,
    model: best.model,
    provider: best.provider,
  };
}
