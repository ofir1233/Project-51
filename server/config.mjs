import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { paths, ensureDirs } from './paths.mjs';

ensureDirs();

// On first run, scaffold .lab/.env with stubs + a fresh LAB_TOKEN.
// Never overwrite an existing one.
if (!existsSync(paths.envFile)) {
  const token = randomBytes(24).toString('hex');
  const initial = [
    '# Project 51 Lab — local secrets. NEVER commit.',
    '# Get a Gemini API key at https://aistudio.google.com/app/apikey',
    'GEMINI_API_KEY=',
    '',
    '# Auto-generated on first start. Required as X-Lab-Token on non-GET API calls.',
    `LAB_TOKEN=${token}`,
    '',
    '# Default providers (override per-call from the lab UI)',
    'LAB_DEFAULT_TEXT_PROVIDER=gemini-text',
    'LAB_DEFAULT_IMAGE_PROVIDER=gemini-image',
    '',
    '# Server',
    'LAB_PORT=5173',
    'LAB_HOST=127.0.0.1',
    '',
  ].join('\n');
  writeFileSync(paths.envFile, initial, { mode: 0o600 });
  console.info(`[config] wrote initial .lab/.env — paste your GEMINI_API_KEY into it`);
}

const parsed = dotenv.parse(readFileSync(paths.envFile));

export const config = Object.freeze({
  port: Number(parsed.LAB_PORT || 5173),
  host: parsed.LAB_HOST || '127.0.0.1',
  geminiApiKey: parsed.GEMINI_API_KEY || '',
  labToken: parsed.LAB_TOKEN || '',
  defaultTextProvider: parsed.LAB_DEFAULT_TEXT_PROVIDER || 'gemini-text',
  defaultImageProvider: parsed.LAB_DEFAULT_IMAGE_PROVIDER || 'gemini-image',
});

if (!config.labToken) {
  console.warn('[config] LAB_TOKEN missing — writes will be rejected. Edit .lab/.env');
}
