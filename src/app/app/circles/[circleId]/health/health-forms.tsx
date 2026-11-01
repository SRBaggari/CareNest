"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";
import { zonedInputToIso } from "@/lib/zoned";

type Kind = "blood_pressure" | "blood_sugar" | "weight" | "temperature" | "pulse" | "oxygen";
type Option = { value: string; label: string };

/**
 * "Record a reading": the fields follow the kind (two numbers for blood pressure, a "when" for
 * sugar) and the unit starts at what families in the parent's country usually use.
 */
export function RecordReadingForm(props: {
  url: string;
  timeZone: string;
  kinds: Option[];
  units: Record<Kind, string[]>;
  defaultUnits: Record<Kind, string>;
  contexts: Option[];
  labels: Record<
    "kind" | "value" | "valueBp" | "value2Bp" | "unit" | "context" | "measuredAt" | "note" | "save" | "saved" | "network" | "generic" | "fixErrors",
    string
  >;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l, { confirm: false });
  const [kind, setKind] = useState<Kind>("blood_pressure");
  const [saved, setSaved] = useState(false);
  const [formKey, setFormKey] = useState(0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const ok = await submit("POST", props.url, {
      kind,
      unit: s("unit"),
      value: s("value"),
      value2: kind === "blood_pressure" ? s("value2") || null : null,
      context: kind === "blood_sugar" ? s("context") || null : null,
      measuredAt: s("measuredAt") ? (zonedInputToIso(s("measuredAt"), props.timeZone) ?? undefined) : undefined,
      note: s("note") || null,
    });
    if (ok) {
      setSaved(true);
      setFormKey((k) => k + 1); // clear the numbers for the next reading
      router.refresh();
    }
  }

  const bp = kind === "blood_pressure";
  return (
    <form key={formKey} onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
      {saved && <Alert tone="success">{l.saved}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <SelectField label={l.kind} name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} options={props.kinds} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label={bp ? l.valueBp : l.value} name="value" inputMode="decimal" autoComplete="off" required errors={fieldErrors.value} />
        {bp && <TextField label={l.value2Bp} name="value2" inputMode="decimal" autoComplete="off" required errors={fieldErrors.value2} />}
        <SelectField
          key={kind}
          label={l.unit}
          name="unit"
          defaultValue={props.defaultUnits[kind]}
          options={props.units[kind].map((u) => ({ value: u, label: u }))}
          errors={fieldErrors.unit}
        />
      </div>
      {kind === "blood_sugar" && <SelectField label={l.context} name="context" defaultValue="random" options={props.contexts} errors={fieldErrors.context} />}
      <TextField label={l.measuredAt} name="measuredAt" type="datetime-local" errors={fieldErrors.measuredAt} />
      <TextField label={l.note} name="note" maxLength={500} errors={fieldErrors.note} />
      <Button type="submit" busy={pending} className="self-start">
        {l.save}
      </Button>
    </form>
  );
}
