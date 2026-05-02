// Online-server config. Reads from process.env (Render injects vars from
// the dashboard; locally you can use a .env file via dotenv).
//
// Kept separate from server/config.mjs (which serves the local Lab and
// auto-creates a .lab/.env scaffold) so the online deploy never touches
// the local-only filesystem layout.

import dotenv from 'dotenv';
dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[online-config] missing required env var: ${name}`);
  return v;
}

export const onlineConfig = Object.freeze({
  port:               Number(process.env.PORT || 8080),
  host:               process.env.HOST || '0.0.0.0',

  supabaseUrl:        required('SUPABASE_URL'),
  supabaseAnonKey:    required('SUPABASE_ANON_KEY'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  geminiApiKey:       process.env.GEMINI_API_KEY || '',

  sceneTtlMs:         Number(process.env.SCENE_TTL_MS || 3 * 24 * 60 * 60 * 1000),
  gridSize:           Number(process.env.GRID_SIZE || 200),

  allowedOrigins:     (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
});
