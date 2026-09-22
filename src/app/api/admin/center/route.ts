import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { getCenter, upsertCenter } from "@/lib/repo/center";
import { normalizeHex } from "@/lib/theme";
import type { Center } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Field caps so a stray paste can't bloat the row; the logo cap keeps the data
// URI well under the SQLite/latency budget (analysis/10 §4, §5.2).
const NAME_MAX = 120;
const WELCOME_MAX = 600;
const LOGO_MAX = 400_000; // ~256KB of raster, base64-encoded
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;

/** Read the center identity + brand layer for the Branding tab. */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const center = getCenter(getDb());
  if (!center) {
    return NextResponse.json({ ok: false, error: "No center seeded." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, center });
}

/**
 * Update the parent-facing identity + copy. Center is single-instance and
 * already seeded, so this patches the existing row (analysis/10 §5.2). Every
 * value is validated server-side: valid #rrggbb, trimmed/capped text, and a
 * logo that must be a raster data URI under the cap (SVG rejected — script
 * surface). Only the fields present in the body are touched.
 */
export async function PATCH(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();

  const current = getCenter(getDb());
  if (!current) {
    return NextResponse.json({ ok: false, error: "No center seeded." }, { status: 404 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const next: Center = { ...current };
  const errors: string[] = [];

  const takeText = (key: "name" | "display_name" | "welcome_message", max: number) => {
    if (!(key in body)) return;
    const raw = body[key];
    if (typeof raw !== "string") {
      errors.push(`${key} must be a string.`);
      return;
    }
    const trimmed = raw.trim().slice(0, max);
    if (key === "name") {
      if (!trimmed) errors.push("Business name can't be empty.");
      else next.name = trimmed;
    } else if (key === "display_name") {
      next.display_name = trimmed; // empty is allowed — falls back at render time
    } else {
      next.welcome_message = trimmed || undefined;
    }
  };

  takeText("name", NAME_MAX);
  takeText("display_name", NAME_MAX);
  takeText("welcome_message", WELCOME_MAX);

  if ("brand_color" in body) {
    const hex = typeof body.brand_color === "string" ? normalizeHex(body.brand_color) : null;
    if (!hex) errors.push("Theme color must be a valid hex like #4f7a5b.");
    else next.brand_color = hex;
  }

  if ("logo" in body) {
    const raw = body.logo;
    if (raw === null || raw === "") {
      next.logo = undefined; // "Remove" falls back to the app icon
    } else if (typeof raw !== "string") {
      errors.push("logo must be a string.");
    } else if (raw.length > LOGO_MAX) {
      errors.push("Logo is too large — please use an image under ~256KB.");
    } else if (!LOGO_RE.test(raw)) {
      errors.push("Logo must be a PNG, JPEG, or WebP image.");
    } else {
      next.logo = raw;
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ ok: false, error: errors.join(" ") }, { status: 400 });
  }

  return NextResponse.json({ ok: true, center: upsertCenter(getDb(), next) });
}
