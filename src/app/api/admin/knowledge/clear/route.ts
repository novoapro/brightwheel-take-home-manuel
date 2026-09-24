import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { deleteAllEntries } from "@/lib/repo/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wipe the entire knowledge base — the "start fresh" companion to import.
 * Escalation capture edges are unlinked first (see `deleteAllEntries`), so
 * escalation history survives. Returns how many entries were removed.
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const db = getDb();
  const removed = deleteAllEntries(db);
  return NextResponse.json({ ok: true, removed });
}
