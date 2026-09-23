import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { getSessionAuditDetail } from "@/lib/repo/audit_view";
import { effectiveAuditMode, getSettings } from "@/lib/repo/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Full audit for one session (analysis/05 §5): transcript + each turn's decision
 * and, when retained, the "what we sent / what we expected" envelope.
 */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId") ?? "";
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "Missing sessionId." }, { status: 400 });
  }
  const db = getDb();
  if (!getSettings(db).developer_mode) {
    return NextResponse.json({ ok: false, error: "Audit is off." }, { status: 403 });
  }
  const detail = getSessionAuditDetail(db, sessionId);
  if (!detail) {
    return NextResponse.json({ ok: false, error: "Unknown sessionId." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, auditMode: effectiveAuditMode(getSettings(db)), ...detail });
}
