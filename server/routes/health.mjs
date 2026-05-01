import { Router } from 'express';
import { config } from '../config.mjs';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '0.0.1',
    phase: 0,
    host: config.host,
    port: config.port,
    geminiKey: config.geminiApiKey ? 'present' : 'missing',
    defaultProviders: {
      text: config.defaultTextProvider,
      image: config.defaultImageProvider,
    },
  });
});
