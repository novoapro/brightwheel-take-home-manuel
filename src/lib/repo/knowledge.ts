import type { Database } from "better-sqlite3";
import { INTENTS } from "../types";
import type {
  Intent,
  KnowledgeEntryInput,
  KnowledgeEntry,
  KnowledgeEntryStatus,
} from "../types";

/**
 * Repository for KnowledgeEntry — the citable source of truth.
 *
 * All functions take an explicit `Database` so they're trivially testable
 * against an in-memory DB. The JSON-shaped columns (structured, keywords) are
 * (de)serialized here so callers only ever see parsed objects.
 */

type EntryRow = {
  id: string;
  intent: Intent;
  title: string;
  body_md: string;
  structured: string;
  keywords: string;
  sensitivity: "none" | "sensitive";
  effective_from: string | null;
  effective_to: string | null;
  source: string | null;
  status: KnowledgeEntryStatus;
  origin: "seed" | "captured";
  version: number;
  updated_by: string | null;
  updated_at: string;
};

function rowToRecord(row: EntryRow): KnowledgeEntry {
  return {
    id: row.id,
    intent: row.intent,
    title: row.title,
    body_md: row.body_md,
    structured: JSON.parse(row.structured) as Record<string, unknown>,
    keywords: JSON.parse(row.keywords) as string[],
    sensitivity: row.sensitivity,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    source: row.source,
    status: row.status,
    origin: row.origin,
    version: row.version,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

/**
 * Insert a new policy, or update an existing one by id (bumping its version).
 * Used by the seed (fresh insert) and by later curation/capture flows.
 */
export function upsertEntry(db: Database, input: KnowledgeEntryInput): KnowledgeEntry {
  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT version FROM knowledge_entries WHERE id = ?`)
    .get(input.id) as { version: number } | undefined;
  const version = existing ? existing.version + 1 : 1;

  db.prepare(
    `INSERT INTO knowledge_entries
       (id, intent, title, body_md, structured, keywords, sensitivity,
        effective_from, effective_to, source, status, origin, version,
        updated_by, updated_at)
     VALUES
       (@id, @intent, @title, @body_md, @structured, @keywords, @sensitivity,
        @effective_from, @effective_to, @source, @status, @origin, @version,
        @updated_by, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
        intent = excluded.intent,
        title = excluded.title,
        body_md = excluded.body_md,
        structured = excluded.structured,
        keywords = excluded.keywords,
        sensitivity = excluded.sensitivity,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        source = excluded.source,
        status = excluded.status,
        origin = excluded.origin,
        version = excluded.version,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at`,
  ).run({
    id: input.id,
    intent: input.intent,
    title: input.title,
    body_md: input.body_md,
    structured: JSON.stringify(input.structured),
    keywords: JSON.stringify(input.keywords),
    sensitivity: input.sensitivity ?? "none",
    effective_from: input.effective_from ?? null,
    effective_to: input.effective_to ?? null,
    source: input.source ?? null,
    status: input.status ?? "published",
    origin: input.origin ?? "seed",
    version,
    updated_by: input.updated_by ?? null,
    updated_at: now,
  });

  return getEntry(db, input.id)!;
}

export function getEntry(db: Database, id: string): KnowledgeEntry | null {
  const row = db.prepare(`SELECT * FROM knowledge_entries WHERE id = ?`).get(id) as
    | EntryRow
    | undefined;
  return row ? rowToRecord(row) : null;
}

export interface ListEntryFilter {
  intent?: Intent;
  status?: KnowledgeEntryStatus;
}

/** List policies, optionally filtered by intent and/or status, id-ordered. */
export function listEntries(
  db: Database,
  filter: ListEntryFilter = {},
): KnowledgeEntry[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter.intent) {
    clauses.push(`intent = @intent`);
    params.intent = filter.intent;
  }
  if (filter.status) {
    clauses.push(`status = @status`);
    params.status = filter.status;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM knowledge_entries ${where} ORDER BY id`)
    .all(params) as EntryRow[];
  return rows.map(rowToRecord);
}

/**
 * Convenience: all published entries — the grounding prefix in M2. Only
 * `published` entries are served; drafts and unpublished entries are withheld.
 */
export function listPublishedEntries(db: Database): KnowledgeEntry[] {
  return listEntries(db, { status: "published" });
}

export function countEntries(db: Database): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries`).get() as { n: number })
    .n;
}

/** Count entries born from the capture loop (origin = captured). */
export function countCapturedEntries(db: Database): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE origin = 'captured'`)
      .get() as { n: number }
  ).n;
}

/**
 * Permanently remove an entry from the knowledge base. Any escalation whose
 * capture edge (`promoted_entry_id`) pointed at it is first unlinked so the
 * FK stays valid and the escalation history is preserved. Returns whether a row
 * was actually deleted.
 */
export function deleteEntry(db: Database, id: string): boolean {
  return db.transaction(() => {
    db.prepare(
      `UPDATE escalations SET promoted_entry_id = NULL WHERE promoted_entry_id = ?`,
    ).run(id);
    const res = db.prepare(`DELETE FROM knowledge_entries WHERE id = ?`).run(id);
    return res.changes > 0;
  })();
}

/**
 * The distinct categories present in the knowledge base, with the built-in core
 * intents first (in their canonical order) followed by any operator-added
 * categories, alphabetically. Powers the editor's category suggestions and the
 * grouped list view.
 */
export function listIntents(db: Database): Intent[] {
  const present = new Set(
    (
      db
        .prepare(`SELECT DISTINCT intent FROM knowledge_entries`)
        .all() as { intent: string }[]
    ).map((r) => r.intent),
  );
  const core = [...INTENTS];
  const extras = [...present]
    .filter((i) => !(INTENTS as readonly string[]).includes(i))
    .sort();
  return [...core, ...extras];
}
