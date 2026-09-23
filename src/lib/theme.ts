/**
 * Layer-B theming (analysis/10 §5): turn one tenant accent hex into the full
 * `--brand*` token set for light *and* dark mode. Pure and testable — the only
 * place a raw color is interpreted. Contrast is *computed*, never trusted, so
 * whatever color a center picks, text on the brand fill still meets WCAG AA.
 *
 * The neutral/structure tokens (background, surface, border) are NOT derived
 * here — they live fixed in globals.css as the Brightwheel base look. Only the
 * accent is per-tenant.
 */

/** Brightwheel blurple — the default accent and the fallback for a bad color. */
export const BRAND_FALLBACK = "#6c4ee8";

export interface Theme {
  /** Light mode */
  brand: string;
  brandStrong: string;
  brandFg: string;
  /** Dark mode (lightened accent so it reads on a dark canvas) */
  brandDark: string;
  brandDarkStrong: string;
  brandDarkFg: string;
}

type Rgb = [number, number, number];

/**
 * Normalize a user-supplied color to `#rrggbb` (lowercased). Accepts 3- or
 * 6-digit hex, with or without `#`. Returns null if it isn't a valid hex color.
 */
export function normalizeHex(input: string): string | null {
  const s = input.trim().toLowerCase();
  const six = /^#?([0-9a-f]{6})$/.exec(s);
  if (six) return `#${six[1]}`;
  const three = /^#?([0-9a-f]{3})$/.exec(s);
  if (three) {
    const [r, g, b] = three[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix a color toward a target by `amount` (0 = unchanged, 1 = fully target). */
function mix(hex: string, target: Rgb, amount: number): string {
  const [r, g, b] = toRgb(hex);
  return toHex([
    r + (target[0] - r) * amount,
    g + (target[1] - g) * amount,
    b + (target[2] - b) * amount,
  ]);
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** WCAG relative luminance of an sRGB color. */
function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick the foreground (white or near-black) with the higher contrast on `hex`. */
export function pickForeground(hex: string): string {
  const rgb = toRgb(hex);
  const nearBlack: Rgb = [26, 26, 26]; // #1a1a1a — softer than pure black
  return contrastRatio(rgb, WHITE) >= contrastRatio(rgb, nearBlack)
    ? "#ffffff"
    : "#1a1a1a";
}

/**
 * Derive the full accent token set from one base hex. Invalid/empty input falls
 * back to Brightwheel blurple, so the app is never left without a legible accent.
 */
export function deriveTheme(input: string): Theme {
  const brand = normalizeHex(input) ?? BRAND_FALLBACK;

  // Light: darken for hover/emphasis; compute a legible foreground.
  const brandStrong = mix(brand, BLACK, 0.22);
  const brandFg = pickForeground(brand);

  // Dark: lift the accent toward white so it doesn't sink into the dark canvas.
  const brandDark = mix(brand, WHITE, 0.26);
  const brandDarkStrong = mix(brand, WHITE, 0.12);
  const brandDarkFg = pickForeground(brandDark);

  return { brand, brandStrong, brandFg, brandDark, brandDarkStrong, brandDarkFg };
}
