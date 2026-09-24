import { describe, it, expect } from "vitest";
import { isAcknowledgment } from "./acknowledgment";

describe("isAcknowledgment — positives (kept in-thread)", () => {
  const acks = [
    "ok",
    "Okay",
    "okay!",
    "k",
    "thanks",
    "Thank you",
    "thank you so much",
    "thanks so much for your help",
    "thx",
    "ty",
    "got it",
    "gotcha",
    "sounds good",
    "sounds good, thanks",
    "perfect",
    "great, thanks!",
    "no problem",
    "will do",
    "understood",
    "makes sense",
    "of course",
    "yes",
    "yep",
    "alright",
    "👍",
    "🙏",
    "ok 👍",
    "thanks 🙏",
  ];
  for (const t of acks) {
    it(`treats ${JSON.stringify(t)} as an acknowledgment`, () => {
      expect(isAcknowledgment(t)).toBe(true);
    });
  }
});

describe("isAcknowledgment — negatives (flow through the pipeline)", () => {
  const notAcks = [
    "",
    "   ",
    "ok but what about pickup?",
    "thanks, but is she allowed back tomorrow?",
    "okay what time do you open",
    "can he come in?",
    "my son has a fever",
    "what are your hours",
    "thanks for the info on the late fee", // "late"/"fee"/"info" are content words
    "yes he has an allergy",
    "sure, but which classroom is she in",
    "okay so the tuition is 1650 right", // has content + would need answering
    "great question", // "question" isn't an ack word
  ];
  for (const t of notAcks) {
    it(`does NOT treat ${JSON.stringify(t)} as an acknowledgment`, () => {
      expect(isAcknowledgment(t)).toBe(false);
    });
  }
});
