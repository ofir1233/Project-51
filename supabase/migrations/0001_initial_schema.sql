-- ─────────────────────────────────────────────────────────────────────────────
--  Project 51 Lab — initial Postgres schema for Supabase
--
--  Tier 1 ("simplest"): one table, ephemeral results.
--
--  How it works end-to-end:
--    1. User submits a prompt.
--    2. Server generates an image (in memory only — never written to disk
--       and never uploaded to Supabase Storage).
--    3. Server samples the image down to a luminance grid (small JSON,
--       ~10–20 KB) and inserts a row here.
--    4. Frontend renders that grid as a Three.js point cloud.
--    5. Rows auto-expire 3 days after creation. A cleanup job (or
--       on-read filter) removes them.
--
--  Privacy story: source images are never persisted; only the prompt
--  and the derived point grid are kept, and only for 3 days.
--
--  Row Level Security: each user only sees their own scenes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE scenes (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  prompt      TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  grid_w      INTEGER NOT NULL,
  grid_h      INTEGER NOT NULL,
  point_grid  JSONB NOT NULL,
  notes       TEXT
);

CREATE INDEX idx_scenes_user_created ON scenes(user_id, created_at DESC);
CREATE INDEX idx_scenes_expires      ON scenes(expires_at);

ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY scenes_owner ON scenes
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
