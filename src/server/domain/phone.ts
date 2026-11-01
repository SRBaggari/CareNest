// Phone numbers for text messages: always stored in international (E.164) form, shown masked.

/**
 * "+91 90000 00001", "0091-90000-00001" or "+44 (0)7700 900123" → "+919000000001" / "+447700900123".
 * An international prefix is required: a family spread across countries can't rely on a local
 * format. Indian mobile numbers are checked more strictly (10 digits starting 6–9). Null if invalid.
 */
export function normalizePhone(input: string): string | null {
  let text = input.trim().replace(/[\s\-().]/g, "");
  if (text.startsWith("00")) text = `+${text.slice(2)}`;
  // A trunk "0" written after the country code, as in "+44 (0)7700…".
  text = text.replace(/^\+(44|61|64|353)0/, "+$1");
  if (!/^\+[1-9]\d{7,14}$/.test(text)) return null;
  if (text.startsWith("+91") && !/^\+91[6-9]\d{9}$/.test(text)) return null;
  return text;
}

/** "+919000000001" → "+91 ••••• •0001": enough to recognise your own number, not to read someone else's. */
export function maskPhone(e164: string): string {
  const cc = e164.startsWith("+91") || e164.startsWith("+44") || e164.startsWith("+61") ? e164.slice(0, 3) : e164.startsWith("+1") ? "+1" : e164.slice(0, 3);
  const rest = e164.slice(cc.length);
  return `${cc} ••••• •${rest.slice(-4)}`;
}
