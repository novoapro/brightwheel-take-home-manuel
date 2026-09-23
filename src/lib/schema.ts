import type { Database } from "better-sqlite3";

/**
 * The full relational schema for Front Desk (M1).
 *
 * Entities map 1:1 to analysis/01-data-and-knowledge-model.md §2:
 *   center, policies (KnowledgeEntry), conversations, messages,
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
export const SCHEMA_VERSION = 9;

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
  sensitivity    TEXT NOT NULL DEFAULT 'none' CHECK (sensitivity IN ('none','sensitive')),
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

-- parent_sessions: a persisted parent identity + thread (analysis/11 §6).
-- Keyed by email so a returning parent resumes their open session; closed
-- manually by the agent or after 30 min of inactivity.
CREATE TABLE IF NOT EXISTS parent_sessions (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  conversation_id TEXT,
  created_at      TEXT NOT NULL,
  last_active_at  TEXT NOT NULL,
  closed_at       TEXT,
  closed_reason   TEXT CHECK (closed_reason IN ('agent','inactivity','parent'))
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
  offline_at      TEXT                              -- ISO auto-offline time, or NULL (never)
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

function tableExists(db: Database, name: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(name) !== undefined
  );
}

function columnExists(db: Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

/**
 * One-time migration for databases created before the Handbook→Knowledge Base
 * rename (schema ≤ 8): the `policies` table becomes `knowledge_entries` (shedding
 * the old intent CHECK so custom categories are allowed and gaining the
 * `unpublished` status), and `escalations.promoted_policy_id` is repointed at the
 * renamed table as `promoted_entry_id`. Best-effort and idempotent — a no-op on a
 * fresh DB (no legacy `policies` table) and safe to run on every boot.
 */
function migrateLegacyPolicies(db: Database): void {
  if (!tableExists(db, "policies")) return;

  // FK pragma is a no-op inside a transaction, so toggle it around the tx.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        INSERT OR IGNORE INTO knowledge_entries
          (id, intent, title, body_md, structured, keywords, sensitivity,
           effective_from, effective_to, source, status, origin, version,
           updated_by, updated_at, embedding)
        SELECT
           id, intent, title, body_md, structured, keywords, sensitivity,
           effective_from, effective_to, source, status, origin, version,
           updated_by, updated_at, embedding
        FROM policies;
      `);

      // Rebuild escalations only if it still carries the old FK column.
      if (columnExists(db, "escalations", "promoted_policy_id")) {
        db.exec(`
          CREATE TABLE escalations_new (
            id                 TEXT PRIMARY KEY,
            interaction_id     TEXT REFERENCES interaction_audit(id),
            question           TEXT NOT NULL,
            detected_intent    TEXT,
            reason             TEXT NOT NULL,
            status             TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','answered','dismissed')),
            operator_answer    TEXT,
            answered_by        TEXT,
            answered_at        TEXT,
            promoted_entry_id  TEXT REFERENCES knowledge_entries(id),
            delivery           TEXT NOT NULL DEFAULT 'live' CHECK (delivery IN ('live','email')),
            contact_name       TEXT,
            contact_email      TEXT,
            delivered_at       TEXT,
            question_embedding BLOB,
            created_at         TEXT NOT NULL
          );
          INSERT INTO escalations_new
            (id, interaction_id, question, detected_intent, reason, status,
             operator_answer, answered_by, answered_at, promoted_entry_id,
             delivery, contact_name, contact_email, delivered_at,
             question_embedding, created_at)
          SELECT
             id, interaction_id, question, detected_intent, reason, status,
             operator_answer, answered_by, answered_at, promoted_policy_id,
             delivery, contact_name, contact_email, delivered_at,
             question_embedding, created_at
          FROM escalations;
          DROP TABLE escalations;
          ALTER TABLE escalations_new RENAME TO escalations;
          CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations (status);
        `);
      }

      db.exec(`DROP TABLE policies;`);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Apply the schema to a database connection. Idempotent — creates any missing
 * tables/indexes and records the schema version. Accepts any Database instance
 * so tests can migrate an in-memory DB.
 */
export function migrate(db: Database): void {
  db.exec(DDL);
  migrateLegacyPolicies(db);
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('app', 'ai-front-desk')
       ON CONFLICT(key) DO NOTHING`,
  ).run();
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION));
}
