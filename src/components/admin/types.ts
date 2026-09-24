/**
 * Client-side mirrors of the relay JSON the admin API returns. Kept here so the
 * queue and the thread view share one definition instead of each redeclaring it.
 * These track the server shapes in src/lib/relay (queue.ts / thread.ts).
 */

/** A cited policy, resolved for a clickable "AI already referenced" chip. */
export type ReferencedPolicy = {
  id: string;
  title: string;
};

/** One unanswered question within a session — a still-waiting escalation. */
export type PendingQuestion = {
  escalationId: string;
  question: string;
  intent: string | null;
  reason: string;
  isCaseSpecific: boolean;
  /** Policies the AI grounded in before relaying (with ids for deep links). */
  aiReferenced: ReferencedPolicy[];
  /** The model's suppressed draft answer, for the operator to accept/edit (or null). */
  aiDraft: string | null;
  captureDefault: boolean;
  waitingSince: string;
};
