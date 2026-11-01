// Understanding a few spoken phrases on the Simple view. Pure, so every phrase in every language is
// tested. It only recognises what to *offer*: every command is confirmed on screen before anything
// is recorded, and "I need help" opens the same Help confirmation as the button.

export type VoiceCommand = "took_medicine" | "need_help" | "feel_fine" | "feel_unwell";

/** Speech languages for each app language (Indian English for "en": the families are mostly in India). */
export const SPEECH_LANG: Record<string, string> = { en: "en-IN", hi: "hi-IN", te: "te-IN", ta: "ta-IN" };

type Patterns = { negation: RegExp; took: RegExp; help: RegExp; unwell: RegExp; fine: RegExp };

// English is matched in every language too: people often mix it in ("medicine వేసుకున్నాను").
const EN: Patterns = {
  negation: /\b(didn'?t|did not|haven'?t|have not|not yet|forgot|won'?t|don'?t)\b/,
  took: /\b(took|taken|had|have taken)\b.*\b(medicines?|tablets?|pills?|doses?|medications?)\b|\b(medicines?|tablets?|pills?) (taken|done)\b/,
  help: /\b(help|emergency|ambulance)\b/,
  unwell: /\b(not|un) ?(feeling )?(well|good|okay|ok|fine)\b|\bunwell\b|\bsick\b|\b(pain|dizzy|fever)\b/,
  fine: /\b(i'?m|i am|feeling|feel) (fine|good|okay|ok|well|alright|all right)\b/,
};

const LOCAL: Record<string, Patterns> = {
  hi: {
    negation: /नहीं|नही|भूल/,
    took: /(दवा|दवाई|गोली|गोलियां|गोलियाँ|medicine|tablet|pill).*(ले ली|लेली|खा ली|खाली|ली है|ले लिया|खा लिया)/,
    help: /मदद|बचाओ|बचाइए|एम्बुलेंस/,
    unwell: /(तबीयत|तबियत|मन).*(ठीक नहीं|खराब|ख़राब)|ठीक नहीं|बीमार|दर्द|चक्कर|बुखार/,
    fine: /(मैं )?(ठीक हूँ|ठीक हूं|अच्छा हूँ|अच्छी हूँ|अच्छा हूं|अच्छी हूं|बढ़िया हूँ)/,
  },
  te: {
    negation: /లేదు|మర్చిపోయా/,
    took: /(మందు|మందులు|మాత్ర|మాత్రలు|టాబ్లెట్|medicine|tablet|pill).*(వేసుకున్నా|వేసుకున్నాను|తీసుకున్నా|తీసుకున్నాను|వేసుకున్నాం)/,
    help: /సహాయం|సాయం|కాపాడండి|అంబులెన్స్/,
    unwell: /బాలేదు|బాగోలేదు|బాగాలేదు|నొప్పి|జ్వరం|కళ్ళు తిరుగుతున్నాయి/,
    fine: /బాగున్నా|బాగున్నాను|బాగానే ఉన్నా|బాగానే ఉన్నాను/,
  },
  ta: {
    negation: /இல்லை|வில்லை|மறந்துட்டேன்|மறந்துவிட்டேன்/,
    took: /(மருந்து|மாத்திரை|மாத்திரைகள்|medicine|tablet|pill).*(சாப்பிட்டேன்|எடுத்தேன்|போட்டேன்|எடுத்துக்கிட்டேன்)/,
    help: /உதவி|காப்பாத்துங்க|காப்பாற்றுங்கள்|ஆம்புலன்ஸ்/,
    unwell: /சரியில்லை|சரியில்ல|முடியல|முடியவில்லை|வலி|காய்ச்சல்|தலை சுத்துது/,
    fine: /நல்லா இருக்கேன்|நன்றாக இருக்கிறேன்|நலமாக இருக்கிறேன்|நல்லா இருக்கேன்|நல்லாருக்கேன்/,
  },
};

/**
 * What the person most likely asked for, or null. Help is checked first (safety), "not well"
 * before "fine" ("not feeling well" contains "well"), and a negated "I didn't take my medicine"
 * never becomes "took".
 */
export function matchCommand(transcript: string, locale: string): VoiceCommand | null {
  const text = transcript.normalize("NFC").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const sets = [EN, ...(LOCAL[locale] ? [LOCAL[locale]] : [])];
  const any = (key: keyof Patterns) => sets.some((p) => p[key].test(text));
  if (any("help")) return "need_help";
  const negated = any("negation");
  if (any("took") && !negated) return "took_medicine";
  if (any("unwell")) return "feel_unwell";
  if (any("fine") && !negated) return "feel_fine";
  return null;
}
