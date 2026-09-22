import { describe, it, expect } from "vitest";
import { groundednessFloor, tau } from "./thresholds";

describe("thresholds", () => {
  it("uses the documented default presets (Balanced 0.75 / 0.9)", () => {
    expect(tau("balanced", false)).toBe(0.75);
    expect(tau("balanced", true)).toBe(0.9);
  });

  it("cautious raises the bar to answer; lean lowers it", () => {
    expect(tau("cautious", false)).toBe(0.85);
    expect(tau("cautious", true)).toBe(0.95);
    expect(tau("lean", false)).toBe(0.65);
    expect(tau("lean", true)).toBe(0.85);
  });

  it("sensitive τ is always ≥ normal τ at the same caution level", () => {
    for (const c of ["cautious", "balanced", "lean"] as const) {
      expect(tau(c, true)).toBeGreaterThanOrEqual(tau(c, false));
    }
  });

  it("groundedness floor is the regulated-domain bar for sensitive", () => {
    expect(groundednessFloor(true)).toBe(0.9);
    expect(groundednessFloor(false)).toBe(0.8);
  });
});
