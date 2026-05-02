// Auth middleware. Pulls the bearer JWT off the Authorization header,
// verifies it via Supabase, attaches { id, email } as req.user, and stashes
// the raw JWT as req.jwt so route handlers can build a user-scoped client.
//
// Reject anything without a valid token. Invite-only access is enforced by
// Supabase Auth itself — only emails the project owner has invited can sign
// in, so a valid JWT is sufficient proof of allowlist membership.

import { adminSupabase } from './supabase.mjs';

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'missing bearer token' });

  const jwt = match[1];
  const { data, error } = await adminSupabase.auth.getUser(jwt);
  if (error || !data?.user) return res.status(401).json({ error: 'invalid token' });

  req.user = { id: data.user.id, email: data.user.email };
  req.jwt = jwt;
  next();
}
