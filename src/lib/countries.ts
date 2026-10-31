// ISO 3166-1 alpha-2 codes offered in pickers. Names come from Intl.DisplayNames in the viewer's language.
const COUNTRY_CODES = [
  "IN", "US", "GB", "CA", "AU", "NZ", "AE", "SA", "QA", "KW", "OM", "BH", "SG", "MY", "LK", "NP", "BD", "PK",
  "DE", "FR", "NL", "IE", "IT", "ES", "SE", "NO", "DK", "FI", "CH", "AT", "BE", "PT", "PL", "JP", "KR", "CN",
  "HK", "PH", "ID", "TH", "ZA", "KE", "NG", "MU", "FJ", "TT", "GY", "BR", "MX",
];

export function countryOptions(locale: string): { value: string; label: string }[] {
  const names = new Intl.DisplayNames([locale, "en"], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code })).sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}
