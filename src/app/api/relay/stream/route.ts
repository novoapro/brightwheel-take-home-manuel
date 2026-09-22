import { getRelayBus } from "@/lib/relay/bus";

// Long-lived SSE needs the Node.js runtime (never Edge) on the always-on container.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parent-side live relay stream (analysis/03 §3.3). The chat opens this for its
 * conversation and receives staff replies in real time as `data:` events. No
 * auth — it's the anonymous parent side; only their own conversation's messages
 * are published to it.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversationId");
  if (!conversationId) {
    return new Response("Missing conversationId", { status: 400 });
  }

  const encoder = new TextEncoder();
  const bus = getRelayBus();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(data));
      // Initial comment establishes the stream promptly for the client.
      send(`: connected\n\n`);

      const unsubscribe = bus.subscribe(conversationId, (event) => {
        send(`event: ${event.type}\ndata: ${JSON.stringify(event.message)}\n\n`);
      });

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
