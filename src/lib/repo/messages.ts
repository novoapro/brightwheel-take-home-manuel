import type { Database } from "better-sqlite3";

/** Message provenance (analysis/01 §2.3b): 📎 grounded, 👤 staff, or none. */
export type Provenance = "grounded" | "staff" | null;

/** Message — one chat turn within a conversation (analysis/01 §2.5). */
export interface Message {
  id: string;
  conversation_id: string;
  role: "parent" | "frontdesk";
  provenance: Provenance;
  text: string;
  citations: string[];
  escalation_id: string | null;
  created_at: string;
}

export interface MessageInput {
  id: string;
  conversation_id: string;
  role: "parent" | "frontdesk";
  provenance?: Provenance;
  text: string;
  citations?: string[];
  escalation_id?: string | null;
}

type MessageRow = Omit<Message, "citations"> & { citations: string | null };

function rowToMessage(row: MessageRow): Message {
  return {
    ...row,
    citations: row.citations ? (JSON.parse(row.citations) as string[]) : [],
  };
}

export function appendMessage(db: Database, input: MessageInput): Message {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO messages
       (id, conversation_id, role, provenance, text, citations, escalation_id, created_at)
     VALUES
       (@id, @conversation_id, @role, @provenance, @text, @citations, @escalation_id, @created_at)`,
  ).run({
    id: input.id,
    conversation_id: input.conversation_id,
    role: input.role,
    provenance: input.provenance ?? null,
    text: input.text,
    citations: JSON.stringify(input.citations ?? []),
    escalation_id: input.escalation_id ?? null,
    created_at,
  });
  return {
    id: input.id,
    conversation_id: input.conversation_id,
    role: input.role,
    provenance: input.provenance ?? null,
    text: input.text,
    citations: input.citations ?? [],
    escalation_id: input.escalation_id ?? null,
    created_at,
  };
}

/** All messages in a conversation, oldest first. */
export function listMessages(db: Database, conversationId: string): Message[] {
  // rowid tiebreak keeps insertion order when two messages share a millisecond
  // timestamp (a parent turn and its answer commit in the same transaction).
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid`,
    )
    .all(conversationId) as MessageRow[];
  return rows.map(rowToMessage);
}
