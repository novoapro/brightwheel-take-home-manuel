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
 * A category's sensitivity tier (analysis/09 §4.3) — operator-owned, three levels:
 *   normal          — answered like any other category.
 *   sensitive       — higher confidence bar (τ) + groundedness floor before we
 *                     answer; general policy still answerable when well-grounded.
 *   always_escalate — never answered; every question in this category relays to
 *                     staff (the old hard-coded `HARD_SENSITIVE` behavior, now a
 *                     per-category setting the operator owns).
 */
export type CategorySensitivity = "normal" | "sensitive" | "always_escalate";

/**
 * Categories seeded as *sensitive* on a fresh install (analysis/09 §4.3). Only a
 * DEFAULT — the tier is a per-category setting operators own from the Knowledge
 * Base ("Manage categories"), read by the decision pipeline via
 * `sensitiveCategorySet()`. Nothing in the guardrail reads this constant.
 */
export const DEFAULT_SENSITIVE_CATEGORIES: readonly Intent[] = ["health"];

/**
 * Category names seeded (and auto-created) as *always-escalate* by default — the
 * old `HARD_SENSITIVE` set. These are just sensible defaults for a fresh center /
 * a freshly-imported category of this name; operators can lower or raise any
 * category's tier afterward. The guardrail reads the live per-category setting,
 * never this list.
 */
export const DEFAULT_ALWAYS_ESCALATE_CATEGORIES: readonly Intent[] = [
  "safety",
  "abuse",
  "incident",
  "custody",
  "legal",
];

/** The tier a category takes when first created, from the default sets above. */
export function defaultSensitivityFor(name: string): CategorySensitivity {
  if ((DEFAULT_ALWAYS_ESCALATE_CATEGORIES as readonly string[]).includes(name)) {
    return "always_escalate";
  }
  if ((DEFAULT_SENSITIVE_CATEGORIES as readonly string[]).includes(name)) {
    return "sensitive";
  }
  return "normal";
}

/**
 * A Knowledge Base category (a.k.a. intent). Operator-owned, first-class: created
 * and removed from the KB editor, each with a `sensitivity` tier that drives the
 * guardrail for any answer classified under it (analysis/09 §4.3).
 */
export interface Category {
  /** Lowercase token; matches `knowledge_entries.intent`. */
  name: string;
  /** Operator-set tier — see `CategorySensitivity`. */
  sensitivity: CategorySensitivity;
  updated_at: string;
}

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
 * Prompt-cache TTL for the grounded system prefix (analysis/04 §4.1, analysis/08).
 * The two values Anthropic's ephemeral cache supports — this is the whole set.
 * Operator-configurable (Settings ▸ AI Assistant); defaults to 1h because
 * front-desk traffic is bursty (clustered at drop-off / pick-up, quiet between),
 * so a 1-hour window keeps the cached handbook warm across gaps. A policy edit
 * changes the prefix bytes and invalidates the cache on its own, so a longer TTL
 * never trades away freshness. Honored by the Claude answerer; OpenAI and Gemini
 * cache automatically with no developer TTL knob, so the value is reserved there.
 */
export type CacheTtl = "5m" | "1h";
export const CACHE_TTLS: readonly CacheTtl[] = ["5m", "1h"];
export const DEFAULT_CACHE_TTL: CacheTtl = "1h";

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
  /**
   * Whether the LLM groundedness judge runs (analysis/04 §3e/§7). On by default.
   * When off we make ONE model call per turn instead of two — the inline
   * groundedness gate and the async metrics judge are both skipped — trading the
   * extra verification for cost. Safe-degrade: an answer under a *sensitive*
   * category, which requires the judge, escalates to staff rather than shipping
   * unverified; non-sensitive answers still pass on the deterministic checks.
   */
  judge_enabled: boolean;
  /**
   * Prompt-cache TTL for the grounded system prefix (see {@link CacheTtl}).
   * Defaults to "1h"; the operator can drop it to "5m" from the AI Assistant
   * settings to shorten the cache window.
   */
  cache_ttl: CacheTtl;
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
