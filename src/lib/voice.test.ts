import { describe, expect, it } from "vitest";
import { matchCommand, SPEECH_LANG } from "./voice";

const cases: [locale: string, said: string, expected: ReturnType<typeof matchCommand>][] = [
  ["en", "I took my medicine", "took_medicine"],
  ["en", "I've taken my tablets", "took_medicine"],
  ["en", "Had my pills", "took_medicine"],
  ["en", "I need help", "need_help"],
  ["en", "Help me please", "need_help"],
  ["en", "I'm fine", "feel_fine"],
  ["en", "I am feeling good today", "feel_fine"],
  ["en", "I'm not feeling well", "feel_unwell"],
  ["en", "I feel sick", "feel_unwell"],
  ["hi", "मैंने दवा ले ली", "took_medicine"],
  ["hi", "गोली खा ली है", "took_medicine"],
  ["hi", "मुझे मदद चाहिए", "need_help"],
  ["hi", "मैं ठीक हूँ", "feel_fine"],
  ["hi", "तबीयत ठीक नहीं है", "feel_unwell"],
  ["te", "నేను మందు వేసుకున్నాను", "took_medicine"],
  ["te", "మాత్రలు తీసుకున్నా", "took_medicine"],
  ["te", "నాకు సహాయం కావాలి", "need_help"],
  ["te", "నేను బాగున్నాను", "feel_fine"],
  ["te", "ఒంట్లో బాలేదు", "feel_unwell"],
  ["ta", "நான் மருந்து சாப்பிட்டேன்", "took_medicine"],
  ["ta", "எனக்கு உதவி வேண்டும்", "need_help"],
  ["ta", "நான் நல்லா இருக்கேன்", "feel_fine"],
  ["ta", "உடம்பு சரியில்லை", "feel_unwell"],
  // Mixed languages, as people really speak.
  ["te", "medicine వేసుకున్నాను", "took_medicine"],
  ["ta", "I took my tablets", "took_medicine"],
];

describe("understanding what was said", () => {
  for (const [locale, said, expected] of cases) {
    it(`${locale}: “${said}” → ${expected}`, () => expect(matchCommand(said, locale)).toBe(expected));
  }

  it("never records a dose that was not taken", () => {
    expect(matchCommand("I didn't take my medicine", "en")).toBeNull();
    expect(matchCommand("I haven't taken my tablets yet", "en")).toBeNull();
    expect(matchCommand("मैंने दवा नहीं ली", "hi")).toBeNull();
    expect(matchCommand("మందు వేసుకోలేదు", "te")).toBeNull();
    expect(matchCommand("மருந்து சாப்பிடவில்லை", "ta")).toBeNull();
  });

  it("puts help first, even when other words are present", () => {
    expect(matchCommand("I took my medicine but I need help", "en")).toBe("need_help");
    expect(matchCommand("I'm fine, but help", "en")).toBe("need_help");
  });

  it("does not guess at anything else", () => {
    expect(matchCommand("", "en")).toBeNull();
    expect(matchCommand("what's the weather", "en")).toBeNull();
    expect(matchCommand("hello", "te")).toBeNull();
  });

  it("has a speech language for every app language", () => {
    expect(Object.keys(SPEECH_LANG).sort()).toEqual(["en", "hi", "ta", "te"]);
  });
});
