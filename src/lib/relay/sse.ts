/**
 * Shared Server-Sent-Events plumbing for the live-relay / presence / queue
 * streams (analysis/03 §3.3, §4.2, analysis/11 §4.2).
 *
 * Every SSE route needs the same lifecycle: a writer, a periodic heartbeat (so
 * proxies don't drop an idle connection), and teardown — clear the heartbeat, run
 * the route's cleanup (its bus unsubscribe), and close the stream — when the
 * client goes away.
 *
 * The subtle, important part: teardown must fire even when the client vanishes
 * WITHOUT `request.signal` emitting "abort" (historically unreliable, especially
 * on the Next dev/Turbopack server across HMR reloads). If we rely on "abort"
 * alone, a dead connection keeps its 25s heartbeat interval and its bus
 * subscription alive forever; across a long session those accumulate — leaked
 * timers, subscriptions, and half-open sockets — until the event loop and memory
 * degrade and the whole server stops responding (API calls included).
 *
 * So `send` self-closes on the first failed enqueue: the moment a write to a gone
 * consumer throws, we tear the stream down instead of pinging a corpse every 25s.
 */
const HEARTBEAT_MS = 25_000;

export function sseResponse(
  request: Request,
  /**
   * Called once the stream is open. Gets the guarded `send`; returns an optional
   * cleanup (typically the bus unsubscribe) run on teardown.
   */
  onStart: (send: (data: string) => void) => (() => void) | void,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let cleanup: (() => void) | void = undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined = undefined;

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        try {
          cleanup?.();
        } catch {
          /* a broken cleanup must not wedge teardown */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          close(); // consumer gone → tear down now, don't keep pinging a corpse
        }
      };

      // start() runs synchronously, so "abort" can only arrive after cleanup and
      // the heartbeat are wired up below — no early-abort race to guard.
      request.signal.addEventListener("abort", close);

      send(`: connected\n\n`);
      cleanup = onStart(send);
      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
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
