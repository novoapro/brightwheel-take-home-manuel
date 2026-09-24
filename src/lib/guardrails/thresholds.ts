import type { CautionLevel } from "../types";

/**
 * τ (tau) presets by operator caution level (analysis/04 §2). τ is the
 * confidence bar to *answer*; sensitive questions get a higher bar so we
 * escalate more readily. Defaults are Balanced = 0.75 / 0.9. Always-escalate
 * categories relay before τ is ever consulted, so these dials never affect them.
 */
const PRESETS: Record<CautionLevel, { normal: number; sensitive: number }> = {
  cautious: { normal: 0.85, sensitive: 0.95 },
  balanced: { normal: 0.75, sensitive: 0.9 },
  lean: { normal: 0.65, sensitive: 0.85 },
};

/** The confidence threshold to answer, given caution level and sensitivity. */
export function tau(caution: CautionLevel, sensitive: boolean): number {
  const p = PRESETS[caution];
  return sensitive ? p.sensitive : p.normal;
}

/** The inline groundedness-gate floor (analysis/04 §3e): ≥0.9 sensitive, ≥0.8 general. */
export function groundednessFloor(sensitive: boolean): number {
  return sensitive ? 0.9 : 0.8;
}
