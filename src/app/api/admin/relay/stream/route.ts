import { getRelayBus } from "@/lib/relay/bus";
import { getDb } from "@/lib/db";
import { isAdminPasscode } from "@/lib/admin";
import { listWaitingEscalations } from "@/lib/repo/escalations";

// Long-lived SSE needs the Node.js runtime (never Edge) on the always-on container.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator-shell relay stream (analysis/03 §4.2). The admin console opens this
 * on sign-in and receives a `queue_changed` event whenever a parent is relayed,
 * answered, or dismissed — so the "Live relay" nav badge updates live from any
 * tab with no polling. Auth rides in the query string (EventSource can't set
 * headers); the passcode is the same demo gate as every other admin route.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!isAdminPasscode(searchParams.get("passcode"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  const bus = getRelayBus();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(data));
      const sendCount = (waiting: number) =>
        send(`event: queue_changed\ndata: ${JSON.stringify({ waiting })}\n\n`);

      send(`: connected\n\n`);
      // Initial snapshot so a just-connected shell is immediately in sync.
      sendCount(listWaitingEscalations(getDb()).length);

      const unsubscribe = bus.subscribeQueue((event) => sendCount(event.waiting));

      // Heartbeat keeps proxies from closing an idle connection.
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
