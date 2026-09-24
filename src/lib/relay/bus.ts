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

export interface StaffMessageEvent {
  type: "staff_message";
  conversationId: string;
  message: {
    id: string;
    escalationId: string;
    text: string;
    answeredBy: string;
    createdAt: string;
    /**
     * How the parent should see this relayed reply: "staff" = a person answered
     * (👤 From our team); "grounded" = the operator forwarded the AI's draft
     * unchanged, so it reads as a normal AI answer (📎) with its sources. Defaults
     * to "staff" when omitted (older events / mid-relay messages).
     */
    provenance?: "grounded" | "staff";
    /** Cited policies for a forwarded AI answer, for the parent's source chips. */
    citations?: { id: string; title: string }[];
  };
}

/** The parent's session was ended server-side — the chat should reset (§6). */
export interface SessionClosedEvent {
  type: "session_closed";
  conversationId: string;
  message: { reason: "agent" | "inactivity" };
}

export type RelayEvent = StaffMessageEvent | SessionClosedEvent;

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

/**
 * The waiting-relay count changed (a parent was relayed, answered, or
 * dismissed). Broadcast to the operator shell so the "Live relay" nav badge
 * updates live from any tab — no polling (analysis/03 §4.2).
 */
export interface QueueChangedEvent {
  type: "queue_changed";
  waiting: number;
}

type Handler = (event: RelayEvent) => void;
type PresenceHandler = (event: PresenceEvent) => void;
type QueueHandler = (event: QueueChangedEvent) => void;

class RelayBus {
  private subscribers = new Map<string, Set<Handler>>();
  private presenceHandlers = new Set<PresenceHandler>();
  private queueHandlers = new Set<QueueHandler>();

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

  /** Subscribe to waiting-relay count changes (the operator shell). */
  subscribeQueue(handler: QueueHandler): () => void {
    this.queueHandlers.add(handler);
    return () => this.queueHandlers.delete(handler);
  }

  /** Broadcast a new waiting-relay count to every connected operator. */
  publishQueue(event: QueueChangedEvent): number {
    for (const handler of this.queueHandlers) {
      try {
        handler(event);
      } catch {
        /* a broken subscriber must not stop the others */
      }
    }
    return this.queueHandlers.size;
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
