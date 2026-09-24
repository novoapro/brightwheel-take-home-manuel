import { getRelayBus, type PresenceEvent } from "@/lib/relay/bus";
import { getDb } from "@/lib/db";
import { resolveAvailability } from "@/lib/repo/settings";
import { sseResponse } from "@/lib/relay/sse";

// Long-lived SSE needs the Node.js runtime (never Edge) on the always-on container.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Center-wide desk-availability stream (analysis/11 §4.2). Every parent chat
 * opens this on mount and receives `presence` events when the operator opens /
 * closes the desk or changes who's on duty — the status pill updates live,
 * mirroring how staff replies stream in. No auth (anonymous parent side).
 * Lifecycle (heartbeat + self-healing teardown) lives in `sseResponse`.
 */
export function GET(request: Request) {
  const bus = getRelayBus();
  return sseResponse(request, (send) => {
    const sendPresence = (p: Omit<PresenceEvent, "type">) =>
      send(`event: presence\ndata: ${JSON.stringify(p)}\n\n`);

    // Initial snapshot so a just-connected client is immediately in sync
    // (also applies any elapsed auto-offline schedule).
    const s = resolveAvailability(getDb());
    sendPresence({
      availability: s.availability,
      operatorName: s.operator_name,
      awayMessage: s.away_message,
    });

    return bus.subscribePresence((event) =>
      sendPresence({
        availability: event.availability,
        operatorName: event.operatorName,
        awayMessage: event.awayMessage,
      }),
    );
  });
}
