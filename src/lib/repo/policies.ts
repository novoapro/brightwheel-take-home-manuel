import type { Database } from "better-sqlite3";
import type {
  Intent,
  PolicyInput,
  PolicyRecord,
  PolicyStatus,
} from "../types";

/**
 * Repository for PolicyRecord — the citable source of truth.
 *
 * All functions take an explicit `Database` so they're trivially testable
 * against an in-memory DB. The JSON-shaped columns (structured, keywords) are
 * (de)serialized here so callers only ever see parsed objects.
 */

type PolicyRow = {
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
  status: PolicyStatus;
  origin: "seed" | "captured";
  version: number;
  updated_by: string | null;
  updated_at: string;
};

function rowToRecord(row: PolicyRow): PolicyRecord {
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
export function upsertPolicy(db: Database, input: PolicyInput): PolicyRecord {
  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT version FROM policies WHERE id = ?`)
    .get(input.id) as { version: number } | undefined;
  const version = existing ? existing.version + 1 : 1;

  db.prepare(
    `INSERT INTO policies
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

  return getPolicy(db, input.id)!;
}

export function getPolicy(db: Database, id: string): PolicyRecord | null {
  const row = db.prepare(`SELECT * FROM policies WHERE id = ?`).get(id) as
    | PolicyRow
    | undefined;
  return row ? rowToRecord(row) : null;
}

export interface ListPolicyFilter {
  intent?: Intent;
  status?: PolicyStatus;
}

/** List policies, optionally filtered by intent and/or status, id-ordered. */
export function listPolicies(
  db: Database,
  filter: ListPolicyFilter = {},
): PolicyRecord[] {
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
    .prepare(`SELECT * FROM policies ${where} ORDER BY id`)
    .all(params) as PolicyRow[];
  return rows.map(rowToRecord);
}

/** Convenience: all published policies — the grounding prefix in M2. */
export function listPublishedPolicies(db: Database): PolicyRecord[] {
  return listPolicies(db, { status: "published" });
}

export function countPolicies(db: Database): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM policies`).get() as { n: number })
    .n;
}

/** Count policies born from the capture loop (origin = captured). */
export function countCapturedPolicies(db: Database): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM policies WHERE origin = 'captured'`)
      .get() as { n: number }
  ).n;
}
