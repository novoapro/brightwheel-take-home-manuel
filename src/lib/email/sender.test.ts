import { describe, it, expect, vi } from "vitest";
import { LoggingEmailSender, getEmailSender } from "./sender";

describe("LoggingEmailSender (simulated, analysis/11 §4.4)", () => {
  it("returns a delivery id and flags the send as simulated", async () => {
    const sender = new LoggingEmailSender();
    const res = await sender.send({
      to: "parent@example.com",
      subject: "Your question",
      body: "Here is the answer.",
    });
    expect(res.id).toMatch(/[0-9a-f-]{36}/);
    expect(res.simulated).toBe(true);
  });

  it("never logs the message body (avoids echoing parent PII)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await new LoggingEmailSender().send({
      to: "parent@example.com",
      subject: "Your question",
      body: "SENSITIVE-BODY-TOKEN",
    });
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("SENSITIVE-BODY-TOKEN");
    expect(logged).toContain("parent@example.com");
    spy.mockRestore();
  });

  it("getEmailSender returns a working sender", async () => {
    const res = await getEmailSender().send({ to: "a@b.com", subject: "s", body: "b" });
    expect(res.simulated).toBe(true);
  });
});
