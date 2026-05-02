// Server-side Supabase clients.
//
//   adminSupabase  — uses the service-role key. Bypasses RLS. Use only for
//                    auth verification and admin tasks (e.g. cleanup jobs).
//                    NEVER expose this to the client.
//
//   userSupabase(jwt) — returns a per-request client scoped to the user's
//                    JWT. RLS applies, so any query runs as that user and
//                    can only touch their own rows. Use this in route
//                    handlers for normal data access.

import { createClient } from '@supabase/supabase-js';
import { onlineConfig } from './online-config.mjs';

export const adminSupabase = createClient(
  onlineConfig.supabaseUrl,
  onlineConfig.supabaseServiceKey,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export function userSupabase(jwt) {
  return createClient(
    onlineConfig.supabaseUrl,
    onlineConfig.supabaseAnonKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    },
  );
}
