import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCenter } from "@/lib/repo/center";
import { listEntries, listIntents } from "@/lib/repo/knowledge";
import type { Intent } from "@/lib/types";

// better-sqlite3 is a native module — force the Node.js runtime (never Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M1 debug route: raw JSON listing of the seeded knowledge base.
 * Optional ?intent= filter (any category). This is a developer/demo aid, not a
 * parent-facing surface — the derived read-only handbook view comes in M5.
 */
export function GET(request: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const intentParam = searchParams.get("intent")?.trim().toLowerCase();
    const intent = intentParam ? (intentParam as Intent) : undefined;

    const entries = listEntries(db, intent ? { intent } : {});

    return NextResponse.json({
      center: getCenter(db),
      count: entries.length,
      intents: listIntents(db),
      entries,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
