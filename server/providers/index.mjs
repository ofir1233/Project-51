import { stubImage } from './stub-image.mjs';
import { config } from '../config.mjs';

const REGISTRY = new Map();

function register(p) { REGISTRY.set(p.name, p); }

register(stubImage);

// Lazily register Gemini providers — Phase 4 will wire these.
async function tryRegisterGemini() {
  try {
    const [{ geminiImage }, { geminiText }] = await Promise.all([
      import('./gemini-image.mjs').catch(() => ({})),
      import('./gemini-text.mjs').catch(() => ({})),
    ]);
    if (geminiImage) register(geminiImage);
    if (geminiText)  register(geminiText);
  } catch (e) {
    console.warn('[providers] gemini providers not available:', e.message);
  }
}
await tryRegisterGemini();

export function listProviders() {
  return Array.from(REGISTRY.values()).map(p => ({
    name: p.name,
    kind: p.kind,
    model: p.model,
    ready: p.ready ?? !!config.geminiApiKey,
    description: p.description || '',
  }));
}

export function resolveProvider({ kind, name }) {
  if (name && REGISTRY.has(name)) {
    const p = REGISTRY.get(name);
    if (kind && p.kind !== kind) throw new Error(`provider ${name} is kind=${p.kind}, wanted ${kind}`);
    return p;
  }
  // fallback to default
  const fallback = kind === 'image'
    ? (REGISTRY.get(config.defaultImageProvider) || REGISTRY.get('stub-image'))
    : (REGISTRY.get(config.defaultTextProvider)  || REGISTRY.get('stub-text'));
  if (!fallback) throw new Error(`no ${kind} provider available`);
  return fallback;
}
