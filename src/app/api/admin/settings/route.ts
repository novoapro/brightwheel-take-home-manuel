import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { effectiveAuditMode, getSettings, resolveAvailability, updateSettings } from "@/lib/repo/settings";
import { purgeDebugEnvelopes } from "@/lib/repo/debug";
import { getRelayBus } from "@/lib/relay/bus";
import { AWAY_MESSAGE_MAX, CACHE_TTLS, OPERATOR_NAME_MAX } from "@/lib/types";
import type { AuditMode, Availability, CacheTtl, CautionLevel, Provider, Settings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAUTIONS: CautionLevel[] = ["cautious", "balanced", "lean"];
const PROVIDERS: Provider[] = ["anthropic", "openai", "google"];
const AVAILABILITIES: Availability[] = ["online", "away"];
const AUDIT_MODES: AuditMode[] = ["off", "flagged", "all"];

/** Read operator settings — caution, provider, availability + operator (analysis/04 §2, 11 §4). */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  // resolveAvailability applies any elapsed auto-offline schedule (analysis/11 §4.1).
  return NextResponse.json({ ok: true, settings: resolveAvailability(getDb()) });
}

/** Update the caution dial, provider, and/or availability. Category sensitivity tiers are owned in the Knowledge Base, not here. */
export async function PUT(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json()) as Record<string, unknown>;
  const patch: Partial<Settings> = {};
  if (CAUTIONS.includes(body.caution_level as CautionLevel)) {
    patch.caution_level = body.caution_level as CautionLevel;
  }
  if (PROVIDERS.includes(body.active_provider as Provider)) {
    patch.active_provider = body.active_provider as Provider;
  }
  if (AVAILABILITIES.includes(body.availability as Availability)) {
    patch.availability = body.availability as Availability;
  }
  if (typeof body.operator_name === "string") {
    patch.operator_name = body.operator_name.trim().slice(0, OPERATOR_NAME_MAX);
  }
  if (typeof body.away_message === "string") {
    patch.away_message = body.away_message.trim().slice(0, AWAY_MESSAGE_MAX);
  }
  if (typeof body.developer_mode === "boolean") {
    patch.developer_mode = body.developer_mode;
  }
  if (AUDIT_MODES.includes(body.audit_mode as AuditMode)) {
    patch.audit_mode = body.audit_mode as AuditMode;
  }
  if (typeof body.judge_enabled === "boolean") {
    patch.judge_enabled = body.judge_enabled;
  }
  if (CACHE_TTLS.includes(body.cache_ttl as CacheTtl)) {
    patch.cache_ttl = body.cache_ttl as CacheTtl;
  }
  // offline_at: null = never; an ISO string = auto-flip to Away at that time.
  if (body.offline_at === null) {
    patch.offline_at = null;
  } else if (typeof body.offline_at === "string") {
    const t = Date.parse(body.offline_at);
    if (!Number.isNaN(t)) patch.offline_at = new Date(t).toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Nothing valid to update (caution_level / active_provider / availability / operator_name / away_message / developer_mode / audit_mode / judge_enabled / cache_ttl).",
      },
      { status: 400 },
    );
  }

  // Invariant: the desk is never Online anonymously — a name is required to go
  // Online (analysis/11 §4.1). Enforced here, not just in the UI. Only guard when
  // the patch actually touches presence — otherwise an unrelated update (e.g.
  // toggling developer_mode) would be rejected whenever the desk happens to be in
  // the default Online-without-a-name state, silently failing to persist.
  const current = getSettings(getDb());
  const nextAvailability = patch.availability ?? current.availability;
  const nextOperator =
    patch.operator_name !== undefined ? patch.operator_name : current.operator_name;
  const touchesPresence =
    patch.availability !== undefined || patch.operator_name !== undefined;
  if (touchesPresence && nextAvailability === "online" && !nextOperator) {
    return NextResponse.json(
      { ok: false, error: "A name is required to go Online." },
      { status: 400 },
    );
  }

  const updated = updateSettings(getDb(), patch);

  // If audit just stopped collecting (developer mode off, or audit_mode = off),
  // drop the stored troubleshooting envelopes — the metrics rollup keeps the
  // numbers, and sessions/transcripts/relays are left untouched (analysis/05 §2).
  if (
    (patch.developer_mode !== undefined || patch.audit_mode !== undefined) &&
    effectiveAuditMode(updated) === "off"
  ) {
    purgeDebugEnvelopes(getDb(), "all");
  }

  // Push the new presence to every connected parent so the status pill updates
  // live (analysis/11 §4.2) — the same SSE model as staff replies.
  if (
    patch.availability !== undefined ||
    patch.operator_name !== undefined ||
    patch.away_message !== undefined
  ) {
    getRelayBus().publishPresence({
      type: "presence",
      availability: updated.availability,
      operatorName: updated.operator_name,
      awayMessage: updated.away_message,
    });
  }

  return NextResponse.json({ ok: true, settings: updated });
}
