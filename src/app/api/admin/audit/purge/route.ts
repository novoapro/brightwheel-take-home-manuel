import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import {
  countRetainedEnvelopes,
  pruneDebugForSession,
  purgeDebugEnvelopes,
  type PurgeScope,
} from "@/lib/repo/debug";
import { getSettings } from "@/lib/repo/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES: PurgeScope[] = ["all", "rated_up"];

/**
 * Remove stored LLM-troubleshooting detail (the `interaction_debug` envelopes) —
 * NOT sessions. Two forms:
 *   - `{ sessionIds: [...] }` clears just those sessions' envelopes (they then
 *     drop out of the Audit view, which lists only sessions with detail);
 *   - `{ scope: "all" | "rated_up" }` clears all (or 👍-only) envelopes.
 * Sessions, transcripts and live relays are never touched, and metrics live in
 * the rollup — so this is always safe.
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json().catch(() => ({}))) as {
    scope?: unknown;
    sessionIds?: unknown;
  };
  const db = getDb();
  if (!getSettings(db).developer_mode) {
    return NextResponse.json({ ok: false, error: "Audit is off." }, { status: 403 });
  }

  let deleted = 0;
  if (Array.isArray(body.sessionIds)) {
    for (const id of body.sessionIds) {
      if (typeof id === "string") deleted += pruneDebugForSession(db, id);
    }
  } else {
    const scope: PurgeScope = SCOPES.includes(body.scope as PurgeScope)
      ? (body.scope as PurgeScope)
      : "all";
    deleted = purgeDebugEnvelopes(db, scope);
  }

  return NextResponse.json({ ok: true, deleted, retained: countRetainedEnvelopes(db) });
}
