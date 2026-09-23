/**
 * In-process pub/sub for the live staff relay (analysis/03 §3.3, analysis/08).
 *
 * The parent's chat holds an SSE stream open; when an operator answers, we
 * publish the staff message to every subscriber of that conversation and it
 * streams into the thread in real time. This is deliberately in-memory: the
 * Railway deployment is a single always-on container, so no Redis/broker is
 * needed (the documented scale-up path if we ever run multiple instances).
 *
 * The bus is stashed on globalThis so it survives dev/HMR module reloads and
 * stays a true singleton across route handlers.
 */

export interface RelayEvent {
  type: "staff_message";
  conversationId: string;
  message: {
    id: string;
    escalationId: string;
    text: string;
    answeredBy: string;
    createdAt: string;
  };
}

/**
 * A center-wide desk-availability change (analysis/11 §4.2). Broadcast to ALL
 * connected parents — not per-conversation — so the status pill updates live the
 * instant an operator opens/closes the desk or changes who's on duty.
 */
export interface PresenceEvent {
  type: "presence";
  availability: "online" | "away";
  operatorName: string;
  awayMessage: string;
}

type Handler = (event: RelayEvent) => void;
type PresenceHandler = (event: PresenceEvent) => void;

class RelayBus {
  private subscribers = new Map<string, Set<Handler>>();
  private presenceHandlers = new Set<PresenceHandler>();

  subscribe(conversationId: string, handler: Handler): () => void {
    let set = this.subscribers.get(conversationId);
    if (!set) {
      set = new Set();
      this.subscribers.set(conversationId, set);
    }
    set.add(handler);
    return () => {
      const s = this.subscribers.get(conversationId);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.subscribers.delete(conversationId);
    };
  }

  publish(event: RelayEvent): number {
    const set = this.subscribers.get(event.conversationId);
    if (!set) return 0;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        /* a broken subscriber must not stop the others */
      }
    }
    return set.size;
  }

  /** Number of live subscribers for a conversation (used in tests). */
  subscriberCount(conversationId: string): number {
    return this.subscribers.get(conversationId)?.size ?? 0;
  }

  /** Subscribe to center-wide presence changes (all parents). */
  subscribePresence(handler: PresenceHandler): () => void {
    this.presenceHandlers.add(handler);
    return () => this.presenceHandlers.delete(handler);
  }

  /** Broadcast a presence change to every connected parent. */
  publishPresence(event: PresenceEvent): number {
    for (const handler of this.presenceHandlers) {
      try {
        handler(event);
      } catch {
        /* a broken subscriber must not stop the others */
      }
    }
    return this.presenceHandlers.size;
  }

  /** Number of live presence subscribers (used in tests). */
  presenceSubscriberCount(): number {
    return this.presenceHandlers.size;
  }
}

const globalKey = "__la_relay_bus__" as const;
type GlobalWithBus = typeof globalThis & { [globalKey]?: RelayBus };

export function getRelayBus(): RelayBus {
  const g = globalThis as GlobalWithBus;
  if (!g[globalKey]) g[globalKey] = new RelayBus();
  return g[globalKey];
}

export type { RelayBus };
