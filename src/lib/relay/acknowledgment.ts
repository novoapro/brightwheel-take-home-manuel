/**
 * Is a parent message a bare acknowledgment — "okay", "thanks", "sounds good",
 * "👍" — with no new question in it?
 *
 * Used only while a human is already relaying into the thread (analysis/03 §3.4):
 * after "let me check with our team", a parent's "okay" or "thank you" should stay
 * in-thread, NOT be re-run through the model (which would either chirp a social
 * reply over the human or re-escalate into a duplicate waiting question). This is
 * deliberately narrow — anything that carries a real question ("ok but what about
 * pickup?") must NOT match, so it flows through the normal pipeline and gets
 * answered. When in doubt, return false: a missed acknowledgment is just handled
 * by the model as usual; a false positive would swallow a real question.
 */

/** Words that, on their own or combined, read as a pure acknowledgment. */
const ACK_WORDS = new Set<string>([
  // affirmations
  "ok", "okay", "okey", "k", "kk", "kay", "alright", "allright", "aight",
  "sure", "yes", "yep", "yup", "ya", "yah", "yeah", "yea", "mhm", "mmk",
  "roger", "bet", "word", "done", "fine", "cool", "sweet", "nice", "lovely",
  // thanks
  "thanks", "thank", "thankyou", "thx", "thnx", "ty", "tysm", "tks", "cheers",
  // praise / warmth
  "great", "perfect", "awesome", "excellent", "brilliant", "wonderful",
  "amazing", "fantastic",
  // "got it" / "sounds good" / "makes sense" / "no problem" / "will do"
  "got", "it", "gotcha", "understood", "noted", "makes", "sense",
  "sounds", "sound", "good", "no", "problem", "np", "worries", "will", "do",
  // small connective/filler words that appear in ack phrases
  "so", "much", "very", "really", "that", "this", "for", "the", "your",
  "help", "helping", "and", "again", "appreciate", "appreciated", "you", "u",
  "of", "course",
]);

/** Positive emoji that read as acknowledgment when a message is emoji-only. */
const POSITIVE_EMOJI =
  /[\u{1F44D}\u{1F44C}\u{1F64F}\u{1F642}\u{1F60A}\u{1F60D}\u{1F970}\u{1F389}\u{1F44F}\u{2764}\u{1F495}\u{1F607}]/u;

export function isAcknowledgment(text: string): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return false;

  // A real question is never a bare acknowledgment.
  if (raw.includes("?")) return false;

  // Extract the words (letters/digits), dropping punctuation and emoji.
  const words = raw
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

  // Emoji-only (no words) → acknowledgment iff it carries a positive emoji.
  if (words.length === 0) return POSITIVE_EMOJI.test(raw);

  // A longer message is doing more than acknowledging.
  if (words.length > 6) return false;

  // Every word must be an acknowledgment word — one content word ("pickup",
  // "fever") means it's not a bare acknowledgment.
  return words.every((w) => ACK_WORDS.has(w));
}
