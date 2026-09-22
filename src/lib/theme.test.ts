import { describe, it, expect } from "vitest";
import {
  BRAND_FALLBACK,
  contrastRatio,
  deriveTheme,
  normalizeHex,
  pickForeground,
} from "./theme";

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe("normalizeHex", () => {
  it("passes through valid #rrggbb, lowercased", () => {
    expect(normalizeHex("#4F7A5B")).toBe("#4f7a5b");
  });
  it("adds a missing #", () => {
    expect(normalizeHex("4f7a5b")).toBe("#4f7a5b");
  });
  it("expands 3-digit shorthand", () => {
    expect(normalizeHex("#0af")).toBe("#00aaff");
  });
  it("rejects garbage", () => {
    expect(normalizeHex("green")).toBeNull();
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("#1234z6")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("deriveTheme", () => {
  it("falls back to Brightwheel blurple on invalid input", () => {
    expect(deriveTheme("nonsense").brand).toBe(BRAND_FALLBACK);
    expect(deriveTheme("").brand).toBe(BRAND_FALLBACK);
  });

  it("keeps a valid base color as the brand", () => {
    expect(deriveTheme("#4f7a5b").brand).toBe("#4f7a5b");
  });

  it("derives a darker strong variant for light mode", () => {
    const t = deriveTheme("#4f7a5b");
    // strong should be darker (lower luminance) than the base
    const lum = (h: string) =>
      toRgb(h).reduce((s, c) => s + c, 0); // cheap ordering proxy
    expect(lum(t.brandStrong)).toBeLessThan(lum(t.brand));
  });

  it("lightens the accent for dark mode", () => {
    const t = deriveTheme("#4f7a5b");
    const sum = (h: string) => toRgb(h).reduce((s, c) => s + c, 0);
    expect(sum(t.brandDark)).toBeGreaterThan(sum(t.brand));
  });

  it("always yields a foreground that meets WCAG AA (>= 4.5) on the fill", () => {
    for (const c of ["#4f7a5b", "#6c4ee8", "#ffff00", "#000000", "#ffffff", "#ff0066"]) {
      const t = deriveTheme(c);
      expect(contrastRatio(toRgb(t.brand), toRgb(t.brandFg))).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(toRgb(t.brandDark), toRgb(t.brandDarkFg)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("pickForeground", () => {
  it("chooses dark text on a light fill", () => {
    expect(pickForeground("#ffff00")).toBe("#1a1a1a");
  });
  it("chooses white text on a dark fill", () => {
    expect(pickForeground("#5638c9")).toBe("#ffffff");
  });
});
