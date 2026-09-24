import type { Database } from "better-sqlite3";
import { defaultSensitivityFor, INTENTS } from "./types";

/**
 * The full relational schema for Front Desk.
 *
 * Entities map 1:1 to analysis/01-data-and-knowledge-model.md §2:
 *   center, knowledge_entries (KnowledgeEntry), conversations, messages,
 *   interaction_audit (InteractionAudit), escalations (Escalation), settings.
 *
 * JSON-shaped fields are TEXT holding JSON; (de)serialization lives at the
 * repository boundary. CHECK constraints encode the canonical enums from
 * analysis/09 §4 so bad values can't reach the DB.
 *
 * The `embedding` / `question_embedding` BLOBs are reserved but unpopulated in
 * v1 (structured-only — analysis/01 §5, §10). A few `interaction_audit` columns
 * (`retrieval`, `latency_human_response_ms`, `operator_disposition`) are likewise
 * reserved for planned analytics/triage work — kept intentionally, not dead.
 *
 * This is a single flat `CREATE TABLE IF NOT EXISTS` pass — no incremental
 * migration history and no in-place column/table upgrades, because nothing is
 * deployed yet. It is idempotent: safe to run on every boot and in tests against
 * a fresh :memory: database. When the shape changes pre-1.0 we edit this DDL and
 * recreate the (disposable) dev DB rather than carrying migrations.
 */
export const SCHEMA_VERSION = 1;

const DDL = `
-- meta: schema version + health-check breadcrumbs
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- center: single-row tenant identity + brand layer (analysis/10 §4).
-- Everything a parent sees (display_name, brand_color, logo, welcome) is
-- configured here — the Front Desk component hardcodes nothing center-specific.
-- With no uploaded logo, surfaces fall back to the app's own icon.
CREATE TABLE IF NOT EXISTS center (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  city            TEXT NOT NULL,
  state           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  timezone        TEXT NOT NULL,
  hours_general   TEXT NOT NULL,
  age_groups      TEXT NOT NULL,        -- JSON array
  persona_notes   TEXT NOT NULL,
  display_name    TEXT NOT NULL DEFAULT '',        -- assistant/front-desk name
  brand_color     TEXT NOT NULL DEFAULT '#6c4ee8', -- tenant accent; drives --brand*
  logo            TEXT,                             -- uploaded logo as a data URI
  welcome_message TEXT                              -- parent greeting override
);

-- knowledge_entries: the atomic, citable source of truth (KnowledgeEntry).
-- intent is an open-ended category (operators add their own from the Knowledge
-- Base editor), so it carries no CHECK constraint — only a NOT NULL.
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id             TEXT PRIMARY KEY,
  intent         TEXT NOT NULL,
  title          TEXT NOT NULL,
  body_md        TEXT NOT NULL,
  structured     TEXT NOT NULL DEFAULT '{}',   -- JSON object
  keywords       TEXT NOT NULL DEFAULT '[]',   -- JSON array
  effective_from TEXT,
  effective_to   TEXT,
  source         TEXT,
  status         TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','draft','unpublished')),
  origin         TEXT NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed','captured')),
  version        INTEGER NOT NULL DEFAULT 1,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL,
  embedding      BLOB                         -- reserved, unpopulated in v1
);
CREATE INDEX IF NOT EXISTS idx_knowledge_intent_status ON knowledge_entries (intent, status);

-- categories: operator-owned KB categories (a.k.a. intents), first-class so their
-- sensitivity is configured, not hard-coded (analysis/09 §4.3). The three-level
-- sensitivity tier drives the guardrail for any answer classified under it:
--   normal | sensitive (higher tau + groundedness floor) | always_escalate
--   (never answered — the old HARD_SENSITIVE behavior, now per-category).
-- Read by the pipeline via sensitiveCategorySet() / alwaysEscalateCategorySet().
-- name mirrors knowledge_entries.intent; a row is auto-created when a new intent
-- first appears on an entry. The core defaults are seeded in migrate().
CREATE TABLE IF NOT EXISTS categories (
  name        TEXT PRIMARY KEY,
  sensitivity TEXT NOT NULL DEFAULT 'normal'
                CHECK (sensitivity IN ('normal','sensitive','always_escalate')),
  updated_at  TEXT NOT NULL
);

-- parent_sessions: a persisted parent identity + thread (analysis/11 §6).
-- Keyed by email so a returning parent resumes their open session; closed
-- manually by the agent or after 30 min of inactivity.
-- The session-level rating (👍/👎 + optional review) is captured at close from a
-- popup (analysis/05 Tier 4 CSAT, moved off individual messages onto the session).
CREATE TABLE IF NOT EXISTS parent_sessions (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  conversation_id TEXT,
  created_at      TEXT NOT NULL,
  last_active_at  TEXT NOT NULL,
  closed_at       TEXT,
  closed_reason   TEXT CHECK (closed_reason IN ('agent','inactivity','parent')),
  rating          TEXT CHECK (rating IN ('up','down')),   -- session-level CSAT
  review          TEXT,                                    -- optional free-text
  rated_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_parent_sessions_email ON parent_sessions (email, status);

-- conversations: a parent chat thread (powers the live relay)
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  active_provider TEXT NOT NULL DEFAULT 'anthropic' CHECK (active_provider IN ('anthropic','openai','google'))
);

-- interaction_audit: one immutable record per parent turn (analysis/05 §2)
CREATE TABLE IF NOT EXISTS interaction_audit (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL,
  conversation_id           TEXT REFERENCES conversations(id),
  timestamp                 TEXT NOT NULL,
  parent_question           TEXT NOT NULL,
  detected_intent           TEXT,
  decision                  TEXT NOT NULL CHECK (decision IN ('answered','escalated')),
  decision_reason           TEXT NOT NULL,
  confidence                REAL,
  provider                  TEXT,
  model                     TEXT,
  response_text             TEXT,
  cited_sources             TEXT NOT NULL DEFAULT '[]',   -- JSON array of policy ids
  retrieval                 TEXT,                          -- JSON; reserved for a retrieval layer, unpopulated in v1
  checks                    TEXT,                          -- JSON guardrail results
  latency_first_response_ms INTEGER,
  latency_human_response_ms INTEGER,                       -- reserved for relay-reply latency, unpopulated in v1
  parent_feedback           TEXT CHECK (parent_feedback IN ('up','down')),
  operator_disposition      TEXT,                          -- JSON; reserved for operator triage outcomes, unpopulated in v1
  judge_scores              TEXT                           -- JSON
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON interaction_audit (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_decision ON interaction_audit (decision);

-- interaction_debug: the heavy "what we sent / what we expected" troubleshooting
-- envelope per turn (analysis/05 §2), isolated from the hot audit table so a
-- retention prune is a cheap row delete. Captured on every turn unless audit is
-- Off; kept or pruned at session close per the operator's audit_mode + rating.
CREATE TABLE IF NOT EXISTS interaction_debug (
  interaction_id TEXT PRIMARY KEY REFERENCES interaction_audit(id),
  system_prompt  TEXT,        -- the cached system prefix we sent the model
  messages       TEXT,        -- JSON: history + the parent question we sent
  raw_proposal   TEXT,        -- JSON: the model's GroundedResult, pre-guardrails
  created_at     TEXT NOT NULL
);

-- metrics_daily: the durable Dashboard rollup (analysis/05). Incremented as each
-- turn/judge/rating arrives so the Dashboard never scans raw rows — which lets us
-- delete raw detail when audit isn't collecting, keeping the DB lean. Bounded:
-- one row per (day, intent, provider).
CREATE TABLE IF NOT EXISTS metrics_daily (
  day                  TEXT NOT NULL,   -- YYYY-MM-DD (UTC)
  intent               TEXT NOT NULL,
  provider             TEXT NOT NULL,
  answered             INTEGER NOT NULL DEFAULT 0,
  escalated            INTEGER NOT NULL DEFAULT 0,
  out_of_scope         INTEGER NOT NULL DEFAULT 0,
  answered_with_source INTEGER NOT NULL DEFAULT 0,
  groundedness_sum     REAL NOT NULL DEFAULT 0,   -- Σ judge groundedness
  groundedness_n       INTEGER NOT NULL DEFAULT 0, -- # scored (for the average)
  PRIMARY KEY (day, intent, provider)
);

-- metrics_csat_daily: session-level 👍/👎 rollup by day (analysis/05 Tier 4).
CREATE TABLE IF NOT EXISTS metrics_csat_daily (
  day  TEXT PRIMARY KEY,
  up   INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0
);

-- escalations: an unknown/sensitive question relayed to staff (Escalation)
CREATE TABLE IF NOT EXISTS escalations (
  id                 TEXT PRIMARY KEY,
  interaction_id     TEXT REFERENCES interaction_audit(id),
  question           TEXT NOT NULL,
  detected_intent    TEXT,
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','answered','dismissed')),
  operator_answer    TEXT,
  answered_by        TEXT,
  answered_at        TEXT,
  promoted_entry_id TEXT REFERENCES knowledge_entries(id),   -- the capture edge
  -- delivery mode + captured contact for off-hours async follow-up (analysis/11 §4.3)
  delivery           TEXT NOT NULL DEFAULT 'live' CHECK (delivery IN ('live','email')),
  contact_name       TEXT,
  contact_email      TEXT,
  delivered_at       TEXT,
  question_embedding BLOB,                            -- reserved, unpopulated in v1
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations (status);

-- messages: individual chat turns within a conversation (Message)
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('parent','frontdesk')),
  provenance      TEXT CHECK (provenance IN ('grounded','staff')),
  text            TEXT NOT NULL,
  citations       TEXT,                              -- JSON array of policy ids
  escalation_id   TEXT REFERENCES escalations(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);

-- settings: operator-controlled, single row (id = 1)
CREATE TABLE IF NOT EXISTS settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  caution_level   TEXT NOT NULL DEFAULT 'balanced' CHECK (caution_level IN ('cautious','balanced','lean')),
  active_provider TEXT NOT NULL DEFAULT 'anthropic' CHECK (active_provider IN ('anthropic','openai','google')),
  -- availability + on-duty operator identity (analysis/11 §4)
  availability    TEXT NOT NULL DEFAULT 'online' CHECK (availability IN ('online','away')),
  operator_name   TEXT NOT NULL DEFAULT '',
  away_message    TEXT NOT NULL DEFAULT '',
  offline_at      TEXT,                             -- ISO auto-offline time, or NULL (never)
  -- developer_mode: gates the whole audit feature (the Audit tab + collection).
  -- Off by default; when off, the effective audit mode is always 'off'.
  developer_mode  INTEGER NOT NULL DEFAULT 0,
  -- audit_mode: how much troubleshooting detail we retain (analysis/05 §2), only
  -- in effect while developer_mode is on.
  --   off     = collect nothing; flagged = keep only sessions that didn't get a
  --   👍 (👎 or unrated); all = keep every session's envelope.
  -- Off by default so enabling developer mode collects nothing until chosen.
  audit_mode      TEXT NOT NULL DEFAULT 'off' CHECK (audit_mode IN ('off','flagged','all')),
  -- judge_enabled: run the LLM groundedness judge (inline gate + async metrics).
  -- On by default; off makes one model call per turn instead of two (cost), with
  -- sensitive answers safe-degrading to escalation (analysis/04 §3e).
  judge_enabled   INTEGER NOT NULL DEFAULT 1
);

-- provider_credentials: per-provider API key (encrypted) + model choice (analysis/11 §3.6).
-- Keys isolated from general settings for clear security scoping; ciphertext only,
-- never plaintext. The seed ships none.
CREATE TABLE IF NOT EXISTS provider_credentials (
  provider       TEXT PRIMARY KEY CHECK (provider IN ('anthropic','openai','google')),
  key_ciphertext TEXT,                              -- base64(iv‖authTag‖ciphertext) AES-256-GCM, nullable
  key_hint       TEXT,                              -- "…7f3a" for the UI
  answerer_model TEXT,                              -- chosen model id
  judge_model    TEXT,                              -- chosen judge id (defaulted)
  valid          INTEGER,                           -- 1/0/null from the liveness check
  last_checked   TEXT
);
`;

/**
 * Apply the schema to a database connection. Idempotent — creates any missing
 * tables/indexes and records the schema version. Accepts any Database instance
 * so tests can migrate an in-memory DB.
 */
export function migrate(db: Database): void {
  db.exec(DDL);
  seedDefaultCategories(db);
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('app', 'ai-front-desk')
       ON CONFLICT(key) DO NOTHING`,
  ).run();
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION));
}

/**
 * Seed the built-in core categories, marking DEFAULT_SENSITIVE_CATEGORIES as
 * sensitive. Runs on every migrate() but only *creates* missing rows — an
 * operator's later sensitivity edits (and any categories they added) are never
 * overwritten. Runs before any entry upsert so a core category always exists with
 * the correct default before it's referenced.
 */
function seedDefaultCategories(db: Database): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO categories (name, sensitivity, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO NOTHING`,
  );
  // Core intents, plus any category already present on an entry (seeded/imported
  // before this table existed). Each gets its default tier from the name (health →
  // sensitive; safety/abuse/… → always_escalate; else normal). OR IGNORE keeps the
  // operator's tier once a row exists — this only fills gaps.
  const names = new Set<string>(INTENTS);
  for (const r of db
    .prepare(`SELECT DISTINCT intent FROM knowledge_entries`)
    .all() as { intent: string }[]) {
    names.add(r.intent);
  }
  for (const name of names) insert.run(name, defaultSensitivityFor(name), now);
}
