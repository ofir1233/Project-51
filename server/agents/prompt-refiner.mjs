import { resolveProvider } from '../providers/index.mjs';

const SYSTEM = `You are the Project 51 Prompt Refiner.

Given a previous prompt and a critique with specific gaps, rewrite the prompt to address each gap. Preserve everything that worked. Be surgical: don't rewrite from scratch, edit.

Output STRICT JSON only:
{
  "done": boolean,                  // true if score ≥ threshold (no further iteration needed)
  "prompt": string,                 // the new prompt (omit if done=true)
  "changeSummary": string           // 1-2 sentence diff explanation
}`;

export async function runPromptRefiner({ previousPrompt, critique, threshold = 8, providerName }) {
  if ((critique?.score ?? 0) >= threshold) {
    return { done: true, prompt: previousPrompt, changeSummary: 'score met threshold; no refinement needed.', tokens: {} };
  }
  const provider = resolveProvider({ kind: 'text', name: providerName });
  const r = await provider.generate({
    system: SYSTEM,
    user: `Previous prompt:\n${previousPrompt}\n\nCritique JSON:\n${JSON.stringify(critique, null, 2)}\n\nThreshold: ${threshold}\n\nReturn JSON.`,
    json: true,
  });
  let parsed;
  try { parsed = JSON.parse(extractJson(r.text)); }
  catch { parsed = { done: false, prompt: previousPrompt, changeSummary: 'parse failed' }; }
  return { ...parsed, raw: r.raw, tokens: r.tokens, text: r.text };
}

function extractJson(s) { const m = s.match(/\{[\s\S]*\}/); return m ? m[0] : s; }
