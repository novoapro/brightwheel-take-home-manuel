import type { Database } from "better-sqlite3";

/**
 * The full relational schema for Front Desk (M1).
 *
 * Entities map 1:1 to analysis/01-data-and-knowledge-model.md §2:
 *   center, policies (PolicyRecord), conversations, messages,
 *   interaction_audit (InteractionAudit), escalations (Escalation), settings.
 *
 * JSON-shaped fields are TEXT holding JSON; (de)serialization lives at the
 * repository boundary. CHECK constraints encode the canonical enums from
 * analysis/09 §4 so bad values can't reach the DB.
 *
 * The `embedding` / `question_embedding` BLOBs are reserved but unpopulated in
 * v1 (structured-only — analysis/01 §5, §10).
 *
 * Migrations are idempotent (CREATE TABLE IF NOT EXISTS): safe to run on every
 * boot and in tests against a fresh :memory: database.
 */
export const SCHEMA_VERSION = 3;

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

-- policies: the atomic, citable source of truth (PolicyRecord)
CREATE TABLE IF NOT EXISTS policies (
  id             TEXT PRIMARY KEY,
  intent         TEXT NOT NULL CHECK (intent IN ('hours','tuition','health','meals','tours')),
  title          TEXT NOT NULL,
  body_md        TEXT NOT NULL,
  structured     TEXT NOT NULL DEFAULT '{}',   -- JSON object
  keywords       TEXT NOT NULL DEFAULT '[]',   -- JSON array
  sensitivity    TEXT NOT NULL DEFAULT 'none' CHECK (sensitivity IN ('none','sensitive')),
  effective_from TEXT,
  effective_to   TEXT,
  source         TEXT,
  status         TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','draft')),
  origin         TEXT NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed','captured')),
  version        INTEGER NOT NULL DEFAULT 1,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL,
  embedding      BLOB                         -- reserved, unpopulated in v1
);
CREATE INDEX IF NOT EXISTS idx_policies_intent_status ON policies (intent, status);

-- conversations: a parent chat thread (powers the live relay)
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  active_provider TEXT NOT NULL DEFAULT 'claude' CHECK (active_provider IN ('claude','gemini'))
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
  retrieval                 TEXT,                          -- JSON, deferred layer
  checks                    TEXT,                          -- JSON guardrail results
  latency_first_response_ms INTEGER,
  latency_human_response_ms INTEGER,
  parent_feedback           TEXT CHECK (parent_feedback IN ('up','down')),
  operator_disposition      TEXT,                          -- JSON
  judge_scores              TEXT                           -- JSON
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON interaction_audit (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_decision ON interaction_audit (decision);

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
  promoted_policy_id TEXT REFERENCES policies(id),   -- the capture edge
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
  active_provider TEXT NOT NULL DEFAULT 'claude' CHECK (active_provider IN ('claude','gemini'))
);
`;

/**
 * Apply the schema to a database connection. Idempotent — creates any missing
 * tables/indexes and records the schema version. Accepts any Database instance
 * so tests can migrate an in-memory DB.
 */
export function migrate(db: Database): void {
  db.exec(DDL);
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('app', 'ai-front-desk')
       ON CONFLICT(key) DO NOTHING`,
  ).run();
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION));
}
