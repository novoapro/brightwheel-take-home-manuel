import { NextResponse } from "next/server";
import { getHealth } from "@/lib/db";

// better-sqlite3 is a native module — force the Node.js runtime (never Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(getHealth());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
