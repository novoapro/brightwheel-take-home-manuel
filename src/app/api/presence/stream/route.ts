import { getRelayBus, type PresenceEvent } from "@/lib/relay/bus";
import { getDb } from "@/lib/db";
import { resolveAvailability } from "@/lib/repo/settings";

// Long-lived SSE needs the Node.js runtime (never Edge) on the always-on container.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Center-wide desk-availability stream (analysis/11 §4.2). Every parent chat
 * opens this on mount and receives `presence` events when the operator opens /
 * closes the desk or changes who's on duty — the status pill updates live,
 * mirroring how staff replies stream in. No auth (anonymous parent side).
 */
export function GET(request: Request) {
  const encoder = new TextEncoder();
  const bus = getRelayBus();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(data));
      const sendPresence = (p: Omit<PresenceEvent, "type">) =>
        send(`event: presence\ndata: ${JSON.stringify(p)}\n\n`);

      send(`: connected\n\n`);

      // Initial snapshot so a just-connected client is immediately in sync
      // (also applies any elapsed auto-offline schedule).
      const s = resolveAvailability(getDb());
      sendPresence({
        availability: s.availability,
        operatorName: s.operator_name,
        awayMessage: s.away_message,
      });

      const unsubscribe = bus.subscribePresence((event) =>
        sendPresence({
          availability: event.availability,
          operatorName: event.operatorName,
          awayMessage: event.awayMessage,
        }),
      );

      const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
