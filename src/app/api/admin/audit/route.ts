import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { listSessionsForAudit, type AuditFilter } from "@/lib/repo/audit_view";
import { countRetainedEnvelopes } from "@/lib/repo/debug";
import { getSettings } from "@/lib/repo/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator Audit list (analysis/05 §5). Two modes: every session, or only those
 * that did not receive a good review (👎 or unrated). Also returns the current
 * audit_mode + retained-envelope count for the panel header + purge affordance.
 */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const { searchParams } = new URL(request.url);
  const mode: AuditFilter = searchParams.get("mode") === "flagged" ? "flagged" : "all";
  const db = getDb();
  const settings = getSettings(db);
  // Developer mode gates the whole feature: when off, audit is off — no data.
  if (!settings.developer_mode) {
    return NextResponse.json({ ok: true, mode, auditMode: "off", retained: 0, sessions: [] });
  }
  return NextResponse.json({
    ok: true,
    mode,
    auditMode: settings.audit_mode,
    retained: countRetainedEnvelopes(db),
    sessions: listSessionsForAudit(db, mode),
  });
}
