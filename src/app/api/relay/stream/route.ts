import { getRelayBus } from "@/lib/relay/bus";
import { sseResponse } from "@/lib/relay/sse";

// Long-lived SSE needs the Node.js runtime (never Edge) on the always-on container.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parent-side live relay stream (analysis/03 §3.3). The chat opens this for its
 * conversation and receives staff replies in real time as `data:` events. No
 * auth — it's the anonymous parent side; only their own conversation's messages
 * are published to it. Lifecycle (heartbeat + self-healing teardown) lives in
 * `sseResponse`.
 */
export function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId) {
    return new Response("Missing conversationId", { status: 400 });
  }

  const bus = getRelayBus();
  return sseResponse(request, (send) =>
    bus.subscribe(conversationId, (event) =>
      send(`event: ${event.type}\ndata: ${JSON.stringify(event.message)}\n\n`),
    ),
  );
}
