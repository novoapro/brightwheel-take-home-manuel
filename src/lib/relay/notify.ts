import { getRelayBus } from "./bus";
import type { ParentSession, SessionCloseReason } from "../repo/sessions";

/**
 * Push a `session_closed` event to each parent's live stream so the chat resets
 * to the sign-in screen the instant their session ends (analysis/11 §6) — the
 * same SSE model as staff replies. Parent-initiated closes need no push (that
 * client already reset itself).
 */
export function notifySessionsClosed(
  sessions: ParentSession[],
  reason: Exclude<SessionCloseReason, "parent">,
): void {
  const bus = getRelayBus();
  for (const s of sessions) {
    if (s.conversation_id) {
      bus.publish({
        type: "session_closed",
        conversationId: s.conversation_id,
        message: { reason },
      });
    }
  }
}
