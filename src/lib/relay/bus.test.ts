import { describe, it, expect } from "vitest";
import { getRelayBus, type RelayEvent } from "./bus";

function ev(conversationId: string, id = "m1"): RelayEvent {
  return {
    type: "staff_message",
    conversationId,
    message: { id, escalationId: "e1", text: "hi", answeredBy: "Maria", createdAt: "t" },
  };
}

describe("relay bus", () => {
  it("delivers events only to subscribers of that conversation", () => {
    const bus = getRelayBus();
    const a: RelayEvent[] = [];
    const b: RelayEvent[] = [];
    const offA = bus.subscribe("conv-A", (e) => a.push(e));
    const offB = bus.subscribe("conv-B", (e) => b.push(e));

    bus.publish(ev("conv-A"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);

    offA();
    offB();
  });

  it("fans out to multiple subscribers and stops after unsubscribe", () => {
    const bus = getRelayBus();
    const seen: string[] = [];
    const off1 = bus.subscribe("c1", () => seen.push("one"));
    const off2 = bus.subscribe("c1", () => seen.push("two"));
    expect(bus.subscriberCount("c1")).toBe(2);

    bus.publish(ev("c1"));
    expect(seen).toEqual(["one", "two"]);

    off1();
    expect(bus.subscriberCount("c1")).toBe(1);
    bus.publish(ev("c1"));
    expect(seen).toEqual(["one", "two", "two"]);

    off2();
    expect(bus.subscriberCount("c1")).toBe(0);
  });

  it("publish to a conversation with no subscribers is a no-op returning 0", () => {
    expect(getRelayBus().publish(ev("nobody-here"))).toBe(0);
  });

  it("a throwing subscriber does not stop the others", () => {
    const bus = getRelayBus();
    const seen: string[] = [];
    const off1 = bus.subscribe("c2", () => {
      throw new Error("boom");
    });
    const off2 = bus.subscribe("c2", () => seen.push("ok"));
    bus.publish(ev("c2"));
    expect(seen).toEqual(["ok"]);
    off1();
    off2();
  });
});
