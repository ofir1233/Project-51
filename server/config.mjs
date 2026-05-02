import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { paths, ensureDirs } from './paths.mjs';

// Two execution contexts share this file:
//   • Local Lab: reads from .lab/.env (auto-scaffolded on first run).
//   • Online (Render): no .lab/ on the deploy — env vars come from process.env.
// Strategy: process.env wins when set; otherwise fall back to .lab/.env.
// Skip the .lab/.env scaffolding entirely when running online (detected by
// the presence of GEMINI_API_KEY in process.env, which Render injects).
const isOnline = !!process.env.GEMINI_API_KEY || !!process.env.SUPABASE_URL;

let parsed = {};
if (!isOnline) {
  ensureDirs();
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
  try { parsed = dotenv.parse(readFileSync(paths.envFile)); } catch {}
}

function pick(key, fallback = '') {
  return process.env[key] || parsed[key] || fallback;
}

export const config = Object.freeze({
  port:                 Number(pick('LAB_PORT', 5173)),
  host:                 pick('LAB_HOST', '127.0.0.1'),
  geminiApiKey:         pick('GEMINI_API_KEY', ''),
  labToken:             pick('LAB_TOKEN', ''),
  defaultTextProvider:  pick('LAB_DEFAULT_TEXT_PROVIDER', 'gemini-text'),
  defaultImageProvider: pick('LAB_DEFAULT_IMAGE_PROVIDER', 'gemini-image'),
});

if (!isOnline && !config.labToken) {
  console.warn('[config] LAB_TOKEN missing — writes will be rejected. Edit .lab/.env');
}
