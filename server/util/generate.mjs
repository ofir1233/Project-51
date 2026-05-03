// Single chokepoint for image generation. Phase 1 always uses the platform
// Gemini key (process.env.GEMINI_API_KEY). Phase 2 will branch here on
// `opts.userId` to fetch the user's BYOK key from the DB and decrement
// credits when applicable — every call site already routes through this
// function, so that swap stays local.

import { resolveProvider } from '../providers/index.mjs';

export async function generateImage({ prompt, refBytes = [], providerName = 'gemini-image', abortSignal } = {}) {
  if (!prompt || typeof prompt !== 'string') throw new Error('prompt required');
  const provider = resolveProvider({ kind: 'image', name: providerName });
  const out = await provider.generate({ prompt, refs: refBytes, abortSignal });
  return {
    bytes:    out.bytes,
    mime:     out.mime,
    provider: provider.name,
    model:    provider.model,
    tokens:   out.tokens || {},
  };
}
