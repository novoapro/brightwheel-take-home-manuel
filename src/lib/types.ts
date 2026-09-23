/**
 * Domain types for the Front Desk data model.
 * Source of truth: analysis/01-data-and-knowledge-model.md §2 and the canonical
 * definitions in analysis/09-plan-review-and-consistency.md §4.
 *
 * JSON-shaped columns (structured, keywords, cited_sources, checks, …) are stored
 * as TEXT in SQLite and (de)serialized at the repository boundary, so callers
 * always work with parsed objects — never raw JSON strings.
 */

/**
 * The built-in core intents the front desk ships with. Operators can add their
 * own categories (e.g. "transportation", "greetings") from the Knowledge Base
 * editor, so an intent is any lowercase token — `INTENTS` are just the defaults
 * we seed and always offer as suggestions.
 */
export const INTENTS = ["hours", "tuition", "health", "meals", "tours"] as const;
/** A knowledge-base category. Open-ended: the core defaults plus operator additions. */
export type Intent = string;
/** One of the built-in core intents (narrowed literal type where it's useful). */
export type CoreIntent = (typeof INTENTS)[number];

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

/**
 * published — served to parents (in the grounding prefix).
 * draft      — a work in progress, not yet served.
 * unpublished — complete but deliberately taken out of service (not served).
 */
export type KnowledgeEntryStatus = "published" | "draft" | "unpublished";
export type KnowledgeEntryOrigin = "seed" | "captured";

/** KnowledgeEntry — the atomic, citable source of truth (analysis/01 §2.2). */
export interface KnowledgeEntry {
  id: string;
  intent: Intent;
  title: string;
  body_md: string;
  /** Typed payload the deterministic policy logic runs on. */
  structured: Record<string, unknown>;
  /** Terms for BM25 / exact-match citation anchoring. */
  keywords: string[];
  effective_from: string | null;
  effective_to: string | null;
  /** Shown in the attribution chip, e.g. "Family Handbook p.4". */
  source: string | null;
  status: KnowledgeEntryStatus;
  origin: KnowledgeEntryOrigin;
  version: number;
  updated_by: string | null;
  updated_at: string;
}

/** Fields accepted when authoring/seeding a policy; the rest get defaults. */
export interface KnowledgeEntryInput {
  id: string;
  intent: Intent;
  title: string;
  body_md: string;
  structured: Record<string, unknown>;
  keywords: string[];
  effective_from?: string | null;
  effective_to?: string | null;
  source?: string | null;
  status?: KnowledgeEntryStatus;
  origin?: KnowledgeEntryOrigin;
  updated_by?: string | null;
}

export type CautionLevel = "cautious" | "balanced" | "lean";
/** Neutral provider ids (analysis/11 §3.1); exactly one is active at a time. */
export type Provider = "anthropic" | "openai" | "google";
export type Availability = "online" | "away";

/**
 * How much per-turn troubleshooting detail the operator retains (analysis/05 §2).
 *   off     — audit disabled: collect nothing.
 *   flagged — capture always; at close keep only sessions that did NOT get a 👍.
 *   all     — capture always; keep every session.
 */
export type AuditMode = "off" | "flagged" | "all";

/** Longest operator name we store / render (analysis/11 §4.6). */
export const OPERATOR_NAME_MAX = 60;

/** Settings — operator-controlled, single row (analysis/01 §2.6, analysis/11 §4). */
export interface Settings {
  caution_level: CautionLevel;
  active_provider: Provider;
  /** Online = live staff relay; Away = handbook-only + async follow-up (analysis/11 §4.1). */
  availability: Availability;
  /**
   * The on-duty operator, center-wide and persisted across Online/Away.
   * A non-empty name is required to be Online (analysis/11 §4.1); it feeds the
   * parent "🟢 {name} is at the front desk" pill and answer attribution.
   */
  operator_name: string;
  /** Optional custom Away disclaimer; empty falls back to the default (analysis/11 §4.2). */
  away_message: string;
  /**
   * When set (ISO), the desk auto-flips to Away at this time — resolved lazily on
   * read (no scheduler). Null = stay Online until manually closed (analysis/11 §4.1).
   */
  offline_at: string | null;
  /**
   * Gates the whole audit feature (the Audit tab + all collection). Off by
   * default; while off the effective audit mode is always "off". Toggling it does
   * not change the stored `audit_mode` (analysis/05 §2).
   */
  developer_mode: boolean;
  /** How much per-turn troubleshooting detail we retain for audit (analysis/05 §2). */
  audit_mode: AuditMode;
}

/** How a staff answer reaches the parent (analysis/11 §4.3). */
export type EscalationDelivery = "live" | "email";

/** Longest custom Away note / captured contact we store (analysis/11 §6). */
export const AWAY_MESSAGE_MAX = 280;
export const CONTACT_FIELD_MAX = 120;

/**
 * Center — identity + globally-relevant facts (analysis/01 §2.1).
 * Also the tenant brand layer (analysis/10 §4): everything a parent sees is
 * configured here from the control center, so nothing center-specific is
 * hardcoded — Front Desk is one component serving many centers.
 */
export interface Center {
  id: string;
  /** The BUSINESS name, e.g. "Little Acorns Early Learning Center". */
  name: string;
  city: string;
  state: string;
  phone: string;
  timezone: string;
  hours_general: string;
  age_groups: Array<{ group: string; range: string }>;
  persona_notes: string;
  /** The ASSISTANT/front-desk name parents read, e.g. "Little Acorns Front Desk". */
  display_name: string;
  /** The one tenant accent hex, e.g. "#4f7a5b"; drives the --brand* tokens. */
  brand_color: string;
  /** Uploaded institution logo (data URI, PoC); with none, the app icon is used. */
  logo?: string;
  /** The parent greeting; falls back to the built-in copy when empty. */
  welcome_message?: string;
}

/** Compute the front-desk name, falling back to "<business> Front Desk". */
export function centerDisplayName(center: Pick<Center, "name" | "display_name">): string {
  const dn = center.display_name?.trim();
  return dn && dn.length > 0 ? dn : `${center.name} Front Desk`;
}
