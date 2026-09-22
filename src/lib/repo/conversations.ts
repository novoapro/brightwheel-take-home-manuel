import type { Database } from "better-sqlite3";
import type { Provider } from "../types";

/** Conversation — a parent chat thread (analysis/01 §2.5). */
export interface Conversation {
  id: string;
  session_id: string;
  started_at: string;
  active_provider: Provider;
}

export function createConversation(
  db: Database,
  input: { id: string; session_id: string; active_provider: Provider },
): Conversation {
  const started_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, session_id, started_at, active_provider)
     VALUES (@id, @session_id, @started_at, @active_provider)`,
  ).run({ ...input, started_at });
  return { ...input, started_at };
}

export function getConversation(
  db: Database,
  id: string,
): Conversation | null {
  const row = db
    .prepare(`SELECT * FROM conversations WHERE id = ?`)
    .get(id) as Conversation | undefined;
  return row ?? null;
}
