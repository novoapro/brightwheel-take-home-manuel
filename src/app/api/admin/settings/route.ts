import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { getSettings, updateSettings } from "@/lib/repo/settings";
import type { CautionLevel, Provider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAUTIONS: CautionLevel[] = ["cautious", "balanced", "lean"];
const PROVIDERS: Provider[] = ["claude", "gemini"];

/** Read operator settings — caution level + active provider (analysis/04 §2). */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  return NextResponse.json({ ok: true, settings: getSettings(getDb()) });
}

/** Update the caution dial and/or provider. HARD_SENSITIVE stays floor-locked. */
export async function PUT(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json()) as Record<string, unknown>;
  const patch: { caution_level?: CautionLevel; active_provider?: Provider } = {};
  if (CAUTIONS.includes(body.caution_level as CautionLevel)) {
    patch.caution_level = body.caution_level as CautionLevel;
  }
  if (PROVIDERS.includes(body.active_provider as Provider)) {
    patch.active_provider = body.active_provider as Provider;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: "Nothing valid to update (caution_level / active_provider)." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, settings: updateSettings(getDb(), patch) });
}
