import { resolveProvider } from '../providers/index.mjs';

const SYSTEM = `You are the Project 51 Lab Architect.

Given a goal for a point-cloud illustration, output a structured plan describing how the 3JS scene should be composed. The shader samples non-bright pixels of source images and renders them as points in WebGL. Your plan is ADVISORY metadata for the prompt-writer downstream.

Return STRICT JSON only:

{
  "layers": [
    {
      "name": "friend" | "me" | "background" | "pair" | string,
      "source": "uploaded:<filename>" | "generate-new",
      "density": "low" | "med" | "high",
      "hover": "left-half" | "right-half" | "whole" | "none",
      "parallax": "back" | "mid" | "front" | "none"
    }
  ],
  "notes": string
}

Constraints:
- Background goes "back" parallax. People go "mid" or "front".
- Sources are halftone-on-white illustrations so the shader's lum-cutoff drops the paper.
- "hover": "left-half" lights when cursor on left or PANE B hovered; "right-half" when cursor on right or PANE A hovered.

Be terse. No prose outside JSON.`;

export async function runArchitect({ goal, providerName }) {
  const provider = resolveProvider({ kind: 'text', name: providerName });
  const r = await provider.generate({
    system: SYSTEM,
    user: `Goal:\n${goal}\n\nReturn JSON.`,
    json: true,
  });
  let plan = null;
  try { plan = JSON.parse(extractJson(r.text)); }
  catch { plan = { layers: [], notes: 'parse failed: ' + r.text.slice(0, 200) }; }
  return { plan, raw: r.raw, tokens: r.tokens, text: r.text };
}

function extractJson(s) {
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : s;
}
