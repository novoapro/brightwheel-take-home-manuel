"use client";

import { useEffect, useRef, useState } from "react";
import BrandMark from "@/components/BrandMark";
import PoweredByBrightwheel from "@/components/PoweredByBrightwheel";
import { renderMarkdownLite } from "@/lib/markdown";

/** The tenant identity the parent surface renders (analysis/10 §4). */
export type CenterBrand = {
  name: string;
  displayName: string;
  logo?: string;
  welcomeMessage?: string;
};

/** Live availability + who's on duty, server-provided (analysis/11 §4). */
export type Presence = {
  availability: "online" | "away";
  operatorName: string;
  awayMessage?: string;
};

const DEFAULT_WELCOME =
  "Hi! I can help with **hours, tuition, sick-day policy, meals, and tours** — with answers straight from our center. What can I help you with?";

/**
 * The parent front desk chat (analysis/03 §3) — mobile-first, warm, one
 * continuous voice. Grounded answers show attribution chips + 👍/👎; uncertain
 * or case-specific turns show a warm relay-pending state ("checking with our
 * team…◐"), and the staff reply streams into the thread live over SSE, marked
 * "✓ From our team".
 */

type Citation = { id: string; title: string; source: string | null };

type ChatMessage = {
  key: string;
  role: "you" | "frontdesk";
  text: string;
  provenance?: "grounded" | "staff" | null;
  citations?: Citation[];
  interactionId?: string;
  decision?: "answered" | "relayed";
  escalationId?: string | null;
  answeredBy?: string;
  pending?: boolean;
  relayPending?: boolean;
  /** "email" = Away follow-up: show a contact-capture form, not a live wait. */
  delivery?: "live" | "email";
  contactDone?: boolean;
  contactEmail?: string;
  feedback?: "up" | "down";
};

const STARTERS = [
  { emoji: "🕐", label: "Hours & closures", question: "Are you open on Veterans Day?" },
  { emoji: "💵", label: "Tuition & fees", question: "How much is tuition?" },
  { emoji: "🤒", label: "Sick child policy", question: "What's your fever policy?" },
  { emoji: "🍎", label: "Meals & lunch", question: "Do you provide lunch or should I pack it?" },
  { emoji: "🚸", label: "Schedule a tour", question: "How do I schedule a tour?" },
];

const SESSION_KEY = "la_frontdesk_session";
const uid = () => Math.random().toString(36).slice(2);

export default function FrontDesk({
  center,
  presence,
}: {
  center: CenterBrand;
  presence?: Presence;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [presenceState, setPresenceState] = useState<Presence | undefined>(presence);
  const [conversationId, setConversationId] = useState<string>();
  const sessionId = useRef<string | undefined>(undefined);
  const logRef = useRef<HTMLDivElement>(null);
  const started = messages.length > 0;

  // Restore a session id so a returning parent keeps their thread.
  useEffect(() => {
    try {
      sessionId.current = localStorage.getItem(SESSION_KEY) ?? undefined;
    } catch {
      /* localStorage may be unavailable — server will mint one */
    }
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Live desk availability: open a center-wide SSE stream on mount so the status
  // pill updates the moment an operator opens/closes the desk (analysis/11 §4.2).
  useEffect(() => {
    const es = new EventSource("/api/presence/stream");
    es.addEventListener("presence", (e) => {
      const p = JSON.parse((e as MessageEvent).data) as {
        availability: "online" | "away";
        operatorName: string;
        awayMessage: string;
      };
      setPresenceState({
        availability: p.availability,
        operatorName: p.operatorName,
        awayMessage: p.awayMessage,
      });
    });
    return () => es.close();
  }, []);

  // Live staff relay: once we have a conversation, subscribe to its SSE stream.
  useEffect(() => {
    if (!conversationId) return;
    const es = new EventSource(
      `/api/relay/stream?conversationId=${encodeURIComponent(conversationId)}`,
    );
    es.addEventListener("staff_message", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as {
        id: string;
        escalationId: string;
        text: string;
        answeredBy: string;
      };
      setMessages((m) => {
        if (m.some((x) => x.key === msg.id)) return m; // de-dupe on reconnect
        return [
          // the matching holding message is no longer "pending" — a person replied
          ...m.map((x) =>
            x.escalationId === msg.escalationId ? { ...x, relayPending: false } : x,
          ),
          {
            key: msg.id,
            role: "frontdesk" as const,
            text: msg.text,
            provenance: "staff" as const,
            answeredBy: msg.answeredBy,
          },
        ];
      });
    });
    return () => es.close();
  }, [conversationId]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);

    const pendingKey = uid();
    setMessages((m) => [
      ...m,
      { key: uid(), role: "you", text: q },
      { key: pendingKey, role: "frontdesk", text: "Checking our handbook…", pending: true },
    ]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          conversationId,
          sessionId: sessionId.current,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Something went wrong.");

      setConversationId(data.conversationId);
      sessionId.current = data.sessionId;
      try {
        localStorage.setItem(SESSION_KEY, data.sessionId);
      } catch {
        /* ignore */
      }

      setMessages((m) =>
        m.map((msg) =>
          msg.key === pendingKey
            ? {
                key: pendingKey,
                role: "frontdesk",
                text: data.message.text,
                provenance: data.message.provenance,
                citations: data.message.citations,
                interactionId: data.interactionId,
                decision: data.decision,
                escalationId: data.message.escalationId,
                delivery: data.message.delivery ?? undefined,
                // Live relays wait on SSE; Away (email) waits on the contact form.
                relayPending:
                  data.decision === "relayed" && data.message.delivery === "live",
              }
            : msg,
        ),
      );
    } catch {
      setMessages((m) =>
        m.map((msg) =>
          msg.key === pendingKey
            ? {
                key: pendingKey,
                role: "frontdesk",
                text: "I'm having trouble reaching our system — let me get our team on this.",
                relayPending: true,
              }
            : msg,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function rate(msg: ChatMessage, feedback: "up" | "down") {
    if (!msg.interactionId || msg.feedback) return;
    setMessages((m) => m.map((x) => (x.key === msg.key ? { ...x, feedback } : x)));
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interactionId: msg.interactionId, feedback }),
      });
    } catch {
      /* best-effort */
    }
  }

  // Away follow-up: parent leaves an email so staff can reply asynchronously
  // (analysis/11 §4.3). On success the form collapses into a confirmation.
  async function submitContact(msg: ChatMessage, name: string, email: string) {
    if (!msg.escalationId) return;
    const res = await fetch("/api/relay/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ escalationId: msg.escalationId, name, email }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? "Could not save your email.");
    }
    setMessages((m) =>
      m.map((x) =>
        x.key === msg.key ? { ...x, contactDone: true, contactEmail: email } : x,
      ),
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col md:border-x md:border-border">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <BrandMark logo={center.logo} />
        <div className="flex-1">
          <h1 className="text-sm font-semibold leading-tight">{center.name}</h1>
          <p className="text-xs text-muted">{center.displayName}</p>
        </div>
        <a href="/handbook" className="text-xs text-brand-strong hover:underline">
          Handbook
        </a>
      </header>

      {presenceState && <PresenceBar presence={presenceState} />}

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation with the front desk"
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5"
      >
        {!started && (
          <Welcome onPick={send} welcome={center.welcomeMessage || DEFAULT_WELCOME} />
        )}

        {messages.map((m) =>
          m.role === "you" ? (
            <div key={m.key} className="self-end max-w-[85%]">
              <div className="rounded-2xl rounded-br-sm bg-you px-4 py-2.5 text-[15px] leading-snug">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.key} className="flex flex-col gap-2">
              <FrontDeskBubble m={m} onRate={rate} logo={center.logo} />
              {m.delivery === "email" && (
                <AwayContactForm m={m} onSubmit={submitContact} />
              )}
            </div>
          ),
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-border px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="q" className="sr-only">Type your question</label>
        <textarea
          id="q"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Type your question…"
          className="min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-2.5 text-[15px] outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-busy={busy}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-brand-fg disabled:opacity-40"
          aria-label="Send"
        >
          ▷
        </button>
      </form>

      <PoweredByBrightwheel />
    </div>
  );
}

function Welcome({ onPick, welcome }: { onPick: (q: string) => void; welcome: string }) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div
        className="text-[15px] leading-relaxed text-foreground [&_strong]:font-semibold"
        dangerouslySetInnerHTML={{ __html: renderMarkdownLite(welcome) }}
      />
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Common questions
        </p>
        {STARTERS.map((s) => (
          <button
            key={s.label}
            onClick={() => onPick(s.question)}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left text-[15px] transition hover:border-brand"
          >
            <span aria-hidden className="text-lg">{s.emoji}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The Online/Away status strip (analysis/11 §4.2). Online names the on-duty
 * operator so the parent sees a real person is reachable; Away is honest about
 * async follow-up. Server-rendered so there's no flash of the wrong state.
 */
function PresenceBar({ presence }: { presence: Presence }) {
  if (presence.availability === "away") {
    const note =
      presence.awayMessage?.trim() ||
      "I can answer common questions from our handbook. For anything I'm unsure about, leave your email and our team will follow up, usually within one business day.";
    return (
      <div className="border-b border-border bg-you px-4 py-2 text-xs text-muted">
        🟡 <span className="font-medium text-foreground">Away</span> — {note}
      </div>
    );
  }
  const who = presence.operatorName
    ? `${presence.operatorName} is at the front desk`
    : "Online";
  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-surface px-4 py-2 text-xs text-muted">
      <span aria-hidden>🟢</span>
      <span className="font-medium text-foreground">{who}</span>
      <span>— usually replies in real time.</span>
    </div>
  );
}

/**
 * Away follow-up capture (analysis/11 §4.3): the parent leaves an email so staff
 * can reply asynchronously. Honest provenance — no fake "live" cue. Collapses to
 * a confirmation on submit.
 */
function AwayContactForm({
  m,
  onSubmit,
}: {
  m: ChatMessage;
  onSubmit: (m: ChatMessage, name: string, email: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  if (m.contactDone) {
    return (
      <div className="ml-8 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-brand-strong">
        ✓ Thanks! We&apos;ll email you at {m.contactEmail} — usually within one
        business day.
      </div>
    );
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      await onSubmit(m, name.trim(), email.trim());
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="ml-8 flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-3">
      <p className="text-xs font-medium text-muted">Where should we send the answer?</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name (optional)"
        aria-label="Your name"
        maxLength={120}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        type="email"
        inputMode="email"
        placeholder="you@example.com"
        aria-label="Your email"
        maxLength={120}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <button
        onClick={submit}
        disabled={busy || !email.trim()}
        className="rounded-lg bg-brand px-4 py-2 text-sm text-brand-fg disabled:opacity-40"
      >
        {busy ? "Saving…" : "Send me the answer"}
      </button>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

function FrontDeskBubble({
  m,
  onRate,
  logo,
}: {
  m: ChatMessage;
  onRate: (m: ChatMessage, f: "up" | "down") => void;
  logo?: string;
}) {
  const isStaff = m.provenance === "staff";
  return (
    <div className="flex max-w-[90%] flex-col gap-2 self-start">
      {isStaff && (
        <div className="ml-8 flex items-center gap-1.5 text-xs font-medium text-brand-strong">
          ✓ From our team{m.answeredBy ? ` · ${m.answeredBy}` : ""}
        </div>
      )}
      <div className="flex items-start gap-2">
        {isStaff ? (
          <span className="mt-0.5 text-lg" aria-hidden>👤</span>
        ) : (
          <BrandMark logo={logo} className="mt-0.5" imgSize={22} />
        )}
        <div
          className={`rounded-2xl rounded-tl-sm px-4 py-2.5 text-[15px] leading-snug shadow-sm ring-1 ${
            isStaff ? "bg-brand/10 ring-brand/30" : "bg-surface ring-border"
          }`}
        >
          {m.pending ? (
            <span className="text-muted">
              {m.text} <span className="animate-softpulse">◐</span>
            </span>
          ) : (
            <span className="whitespace-pre-wrap">{m.text}</span>
          )}
        </div>
      </div>

      {/* Attribution chips — the trust cue (analysis/03 §3.2) */}
      {m.citations && m.citations.length > 0 && (
        <div className="ml-8 flex flex-wrap gap-1.5">
          {m.citations.map((c) => (
            <a
              key={c.id}
              href={`/handbook#${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title={c.source ?? undefined}
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs text-brand-strong hover:bg-brand/20"
            >
              📎 per our Handbook — {c.title} ›
            </a>
          ))}
        </div>
      )}

      {/* Relay-pending — checking with our team, in real time */}
      {m.relayPending && (
        <div className="ml-8 flex items-center gap-1.5 text-xs text-muted">
          <span className="animate-softpulse" aria-hidden>◐</span>
          Checking with our team — one moment…
        </div>
      )}

      {/* Thumbs — CSAT (analysis/05 Tier 4) */}
      {m.decision === "answered" && m.interactionId && (
        <div className="ml-8 flex items-center gap-2 text-sm">
          {m.feedback ? (
            <span className="text-xs text-muted">
              {m.feedback === "up" ? "Thanks for the feedback! 👍" : "Thanks — we'll do better. 👎"}
            </span>
          ) : (
            <>
              <span className="text-xs text-muted">Helpful?</span>
              <button onClick={() => onRate(m, "up")} aria-label="Helpful" className="rounded-full px-1.5 py-0.5 hover:bg-you">👍</button>
              <button onClick={() => onRate(m, "down")} aria-label="Not helpful" className="rounded-full px-1.5 py-0.5 hover:bg-you">👎</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
