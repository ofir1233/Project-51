import { Router } from 'express';
import { config } from '../config.mjs';

export const providersRouter = Router();

// Phase 1: registry is hard-coded. Phase 2 will populate from providers/index.mjs.
providersRouter.get('/providers', (req, res) => {
  res.json({
    image: [
      { name: 'stub-image',   model: 'stub',                      ready: true,  description: 'Deterministic test PNG, no external calls' },
      { name: 'gemini-image', model: 'gemini-2.5-flash-image',    ready: !!config.geminiApiKey, description: 'Gemini 2.5 Flash Image, image-to-image' },
    ],
    text: [
      { name: 'stub-text',    model: 'stub',                      ready: true,  description: 'Deterministic test text' },
      { name: 'gemini-text',  model: 'gemini-2.5-flash',          ready: !!config.geminiApiKey, description: 'Gemini 2.5 Flash, text + vision' },
    ],
    defaults: {
      image: config.defaultImageProvider,
      text: config.defaultTextProvider,
    },
  });
});
