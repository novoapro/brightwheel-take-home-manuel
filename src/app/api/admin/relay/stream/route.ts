import { getRelayBus } from "@/lib/relay/bus";
import { getDb } from "@/lib/db";
import { isAdminPasscode } from "@/lib/admin";
import { listWaitingEscalations } from "@/lib/repo/escalations";
import { sseResponse } from "@/lib/relay/sse";

// Long-lived SSE needs the Node.js runtime (never Edge) on the always-on container.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator-shell relay stream (analysis/03 §4.2). The admin console opens this
 * on sign-in and receives a `queue_changed` event whenever a parent is relayed,
 * answered, or dismissed — so the "Live relay" nav badge updates live from any
 * tab with no polling. Auth rides in the query string (EventSource can't set
 * headers); the passcode is the same demo gate as every other admin route.
 * Lifecycle (heartbeat + self-healing teardown) lives in `sseResponse`.
 */
export function GET(request: Request) {
  if (!isAdminPasscode(new URL(request.url).searchParams.get("passcode"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const bus = getRelayBus();
  return sseResponse(request, (send) => {
    const sendCount = (waiting: number) =>
      send(`event: queue_changed\ndata: ${JSON.stringify({ waiting })}\n\n`);

    // Initial snapshot so a just-connected shell is immediately in sync.
    sendCount(listWaitingEscalations(getDb()).length);

    return bus.subscribeQueue((event) => sendCount(event.waiting));
  });
}
