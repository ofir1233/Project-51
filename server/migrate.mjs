import { db, closeDb } from './db.mjs';

const SCHEMA = [
  // V1
  `CREATE TABLE IF NOT EXISTS generations (
    id            TEXT PRIMARY KEY,
    created_at    INTEGER NOT NULL,
    parent_id     TEXT,
    chain_run_id  TEXT,
    iteration     INTEGER,
    goal          TEXT,
    prompt        TEXT NOT NULL,
    prompt_hash   TEXT NOT NULL,
    ref_ids_json  TEXT NOT NULL DEFAULT '[]',
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    width         INTEGER,
    height        INTEGER,
    file_path     TEXT NOT NULL,
    thumb_path    TEXT,
    score         REAL,
    critique_json TEXT,
    visibility    TEXT NOT NULL DEFAULT 'visible'
                  CHECK (visibility IN ('visible','hidden')),
    starred       INTEGER NOT NULL DEFAULT 0,
    notes         TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gen_created    ON generations(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_gen_visibility ON generations(visibility)`,
  `CREATE INDEX IF NOT EXISTS idx_gen_starred    ON generations(starred)`,
  `CREATE INDEX IF NOT EXISTS idx_gen_chain_run  ON generations(chain_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gen_score      ON generations(score DESC)`,

  `CREATE TABLE IF NOT EXISTS chain_runs (
    id            TEXT PRIMARY KEY,
    created_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    goal          TEXT NOT NULL,
    config_json   TEXT NOT NULL,
    status        TEXT NOT NULL,
    best_gen_id   TEXT,
    error         TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_created ON chain_runs(created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS agent_runs (
    id              TEXT PRIMARY KEY,
    chain_run_id    TEXT NOT NULL,
    iteration       INTEGER NOT NULL,
    step_name       TEXT NOT NULL,
    step_index      INTEGER NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    input_json      TEXT NOT NULL,
    output_json     TEXT,
    output_text     TEXT,
    generation_id   TEXT,
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER,
    latency_ms      INTEGER,
    prompt_tokens   INTEGER,
    output_tokens   INTEGER,
    total_tokens    INTEGER,
    cost_usd        REAL,
    status          TEXT NOT NULL,
    error           TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agentruns_chain ON agent_runs(chain_run_id, step_index)`,

  `CREATE TABLE IF NOT EXISTS snapshots (
    id             TEXT PRIMARY KEY,
    created_at     INTEGER NOT NULL,
    reason         TEXT NOT NULL,
    slot           TEXT NOT NULL,
    live_rel_path  TEXT NOT NULL,
    archive_path   TEXT NOT NULL,
    sha256         TEXT NOT NULL,
    size_bytes     INTEGER NOT NULL,
    note           TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_snap_slot ON snapshots(slot, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS approvals (
    id              TEXT PRIMARY KEY,
    created_at      INTEGER NOT NULL,
    generation_id   TEXT NOT NULL,
    slot            TEXT NOT NULL,
    snapshot_id     TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_appr_active_slot ON approvals(slot) WHERE active = 1`,

  `CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS tags (
    generation_id TEXT NOT NULL,
    tag           TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (generation_id, tag)
  )`,

  // Unified ledger of every assessment a generation receives:
  //   source = 'user'   → user explicit good/bad + context text
  //   source = 'judge'  → end-of-funnel Aesthetic Judge prediction (learns from user history)
  //   source = 'critic' → in-loop Style Critic score+gaps
  // The Judge pulls recent rows with source='user' as few-shot context to align with user taste.
  `CREATE TABLE IF NOT EXISTS judgments (
    id              TEXT PRIMARY KEY,
    generation_id   TEXT NOT NULL,
    source          TEXT NOT NULL CHECK (source IN ('user','judge','critic')),
    rating          TEXT CHECK (rating IN ('good','bad','meh') OR rating IS NULL),
    score           REAL,
    reasoning       TEXT,
    context_json    TEXT,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (generation_id) REFERENCES generations(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_judg_gen     ON judgments(generation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_judg_source  ON judgments(source, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_judg_rating  ON judgments(rating)`,

  // Auto-detected (or manually-added) elements per generation.
  // bbox is normalized 0..1 (x,y,w,h) so it's resolution-agnostic.
  `CREATE TABLE IF NOT EXISTS element_detections (
    id              TEXT PRIMARY KEY,
    generation_id   TEXT NOT NULL,
    label           TEXT NOT NULL,
    bbox_x          REAL NOT NULL,
    bbox_y          REAL NOT NULL,
    bbox_w          REAL NOT NULL,
    bbox_h          REAL NOT NULL,
    confidence      REAL,
    manual          INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (generation_id) REFERENCES generations(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_elem_gen ON element_detections(generation_id)`,

  // Scene graph per generation: groups + reactions + which elements belong to each group.
  // Stored as JSON blob since the structure is hierarchical and small.
  `CREATE TABLE IF NOT EXISTS scene_graphs (
    generation_id   TEXT PRIMARY KEY,
    graph_json      TEXT NOT NULL,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (generation_id) REFERENCES generations(id)
  )`,

  // Improvement feedback — text the user typed in the Approve overlay
  // ('improve' button). The refiner uses these as forced gaps.
  `CREATE TABLE IF NOT EXISTS improvement_feedback (
    id              TEXT PRIMARY KEY,
    generation_id   TEXT NOT NULL,
    feedback_text   TEXT NOT NULL,
    follow_up_id    TEXT,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (generation_id) REFERENCES generations(id),
    FOREIGN KEY (follow_up_id)  REFERENCES generations(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_gen ON improvement_feedback(generation_id, created_at DESC)`,
];

export function migrate() {
  const d = db();
  const userVersion = d.pragma('user_version', { simple: true });
  console.info(`[migrate] current user_version = ${userVersion}`);

  d.transaction(() => {
    for (const stmt of SCHEMA) d.exec(stmt);
    d.pragma('user_version = 1');
  })();

  const tables = d.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
  console.info(`[migrate] tables: ${tables.join(', ')}`);
  console.info(`[migrate] user_version = ${d.pragma('user_version', { simple: true })}`);
}

// CLI entry
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('migrate.mjs')) {
  try { migrate(); closeDb(); }
  catch (e) { console.error('[migrate] failed:', e.message); process.exit(1); }
}
