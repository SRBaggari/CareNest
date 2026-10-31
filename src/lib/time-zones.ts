/** All IANA time zones the runtime knows, for pickers. */
export function listTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export function timeZoneOptions(): { value: string; label: string }[] {
  return listTimeZones().map((z) => ({ value: z, label: z.replaceAll("_", " ") }));
}
