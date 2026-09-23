import { randomUUID } from "node:crypto";

/**
 * Email delivery seam (analysis/11 §4.4). Real email is a non-goal for the PoC
 * ([00 §8]) but *simulating* it is allowed — so we mirror the model seam: one
 * interface, a logging PoC impl, and a real provider (Resend/Postmark) pluggable
 * later behind the same contract. No third party is ever contacted here.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailResult {
  id: string;
  simulated: boolean;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<EmailResult>;
}

/**
 * PoC sender: records the send to the server log (an audit breadcrumb) and
 * returns a delivery id, without reaching any external service. The operator UI
 * surfaces this as "📧 Sent (simulated)".
 */
export class LoggingEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<EmailResult> {
    const id = randomUUID();
    // Never log the body (may echo parent PII); subject + recipient are enough.
    console.log(
      `[email:simulated] id=${id} to=${msg.to} subject=${JSON.stringify(msg.subject)}`,
    );
    return { id, simulated: true };
  }
}

/**
 * Resolve the active email sender. Today always the simulated sender; wiring a
 * real provider is a one-line swap gated on an env key (the documented next step).
 */
export function getEmailSender(): EmailSender {
  return new LoggingEmailSender();
}
