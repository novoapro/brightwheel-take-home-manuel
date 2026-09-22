/**
 * Domain types for the AI Front Desk data model.
 * Source of truth: analysis/01-data-and-knowledge-model.md §2 and the canonical
 * definitions in analysis/09-plan-review-and-consistency.md §4.
 *
 * JSON-shaped columns (structured, keywords, cited_sources, checks, …) are stored
 * as TEXT in SQLite and (de)serialized at the repository boundary, so callers
 * always work with parsed objects — never raw JSON strings.
 */

/** The five core intents the front desk handles, plus the out-of-scope bucket. */
export const INTENTS = ["hours", "tuition", "health", "meals", "tours"] as const;
export type Intent = (typeof INTENTS)[number];

/** detected_intent on an interaction/escalation can also be out_of_scope. */
export type DetectedIntent = Intent | "out_of_scope";

/**
 * Intents that are intrinsically sensitive and carry the higher groundedness
 * threshold (τ=0.9). Canonical set — analysis/09 §4.3. Only `health` qualifies.
 */
export const SENSITIVE_INTENTS: readonly Intent[] = ["health"];

/** Canonical sensitive_category set — analysis/09 §4.1. */
export const SENSITIVE_CATEGORIES = [
  "safety",
  "abuse",
  "incident",
  "health",
  "custody",
  "billing",
  "enrollment",
  "behavior",
  "individual",
  "grievance",
  "legal",
] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

/**
 * Always-escalate, floor-locked categories — never operator-lowered.
 * Canonical set — analysis/09 §4.2.
 */
export const HARD_SENSITIVE: readonly SensitiveCategory[] = [
  "safety",
  "abuse",
  "incident",
  "custody",
  "legal",
];

export type PolicySensitivity = "none" | "sensitive";
export type PolicyStatus = "published" | "draft";
export type PolicyOrigin = "seed" | "captured";

/** PolicyRecord — the atomic, citable source of truth (analysis/01 §2.2). */
export interface PolicyRecord {
  id: string;
  intent: Intent;
  title: string;
  body_md: string;
  /** Typed payload the deterministic policy logic runs on. */
  structured: Record<string, unknown>;
  /** Terms for BM25 / exact-match citation anchoring. */
  keywords: string[];
  sensitivity: PolicySensitivity;
  effective_from: string | null;
  effective_to: string | null;
  /** Shown in the attribution chip, e.g. "Family Handbook p.4". */
  source: string | null;
  status: PolicyStatus;
  origin: PolicyOrigin;
  version: number;
  updated_by: string | null;
  updated_at: string;
}

/** Fields accepted when authoring/seeding a policy; the rest get defaults. */
export interface PolicyInput {
  id: string;
  intent: Intent;
  title: string;
  body_md: string;
  structured: Record<string, unknown>;
  keywords: string[];
  sensitivity?: PolicySensitivity;
  effective_from?: string | null;
  effective_to?: string | null;
  source?: string | null;
  status?: PolicyStatus;
  origin?: PolicyOrigin;
  updated_by?: string | null;
}

export type CautionLevel = "cautious" | "balanced" | "lean";
export type Provider = "claude" | "gemini";

/** Settings — operator-controlled, single row (analysis/01 §2.6). */
export interface Settings {
  caution_level: CautionLevel;
  active_provider: Provider;
}

/** Center — identity + globally-relevant facts (analysis/01 §2.1). */
export interface Center {
  id: string;
  name: string;
  city: string;
  state: string;
  phone: string;
  timezone: string;
  hours_general: string;
  age_groups: Array<{ group: string; range: string }>;
  persona_notes: string;
}
