"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Option = { value: string; label: string };
type Messages = { network: string; generic: string; fixErrors: string };

export function ProfileEditForm(props: {
  url: string;
  circle: {
    name: string;
    displayName: string;
    preferredName: string | null;
    dateOfBirth: string | null;
    timeZone: string;
    country: string;
    locale: string;
    emergencyNumber: string;
    version: number;
  };
  timeZones: Option[];
  countries: Option[];
  locales: Option[];
  labels: Messages & Record<string, string>;
}) {
  const { labels: l, circle: c } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l, { confirm: false });
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const result = await submit("PATCH", props.url, {
      version: c.version,
      name: s("name"),
      displayName: s("displayName"),
      preferredName: s("preferredName"),
      dateOfBirth: s("dateOfBirth") || null,
      timeZone: s("timeZone"),
      country: s("country"),
      locale: s("locale"),
      emergencyNumber: s("emergencyNumber"),
    });
    if (result) setSaved(true);
    // Refresh either way: on a 409 conflict this loads the other person's changes and new version.
    router.refresh();
  }

  return (
    <form key={c.version} onSubmit={onSubmit} noValidate className="mt-4 flex max-w-xl flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">{l.saved}</Alert>}
      <TextField label={l.circleName} name="name" defaultValue={c.name} errors={fieldErrors.name} />
      <TextField label={l.displayName} name="displayName" defaultValue={c.displayName} errors={fieldErrors.displayName} />
      <TextField label={l.preferredName} name="preferredName" defaultValue={c.preferredName ?? ""} errors={fieldErrors.preferredName} />
      <TextField label={l.dateOfBirth} name="dateOfBirth" type="date" defaultValue={c.dateOfBirth ?? ""} errors={fieldErrors.dateOfBirth} />
      <SelectField label={l.timeZone} name="timeZone" defaultValue={c.timeZone} options={props.timeZones} errors={fieldErrors.timeZone} />
      <SelectField label={l.country} name="country" defaultValue={c.country} options={props.countries} errors={fieldErrors.country} />
      <SelectField label={l.language} name="locale" defaultValue={c.locale} options={props.locales} errors={fieldErrors.locale} />
      <TextField label={l.emergencyNumber} name="emergencyNumber" type="tel" defaultValue={c.emergencyNumber} errors={fieldErrors.emergencyNumber} />
      <Button type="submit" busy={pending} className="self-start">
        {l.save}
      </Button>
    </form>
  );
}

const CONSENT_KEYS = ["shareMedications", "shareAppointments", "shareHealth"] as const;

export function PrivacyForm(props: {
  url: string;
  consent: Record<(typeof CONSENT_KEYS)[number], boolean>;
  editable: boolean;
  labels: Messages & Record<string, string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit(l, { confirm: false });
  const [saved, setSaved] = useState(false);

  if (!props.editable) {
    return (
      <dl className="mt-4 grid gap-2">
        {CONSENT_KEYS.map((k) => (
          <div key={k} className="flex flex-wrap gap-2">
            <dt>{l[k]}:</dt>
            <dd className="font-semibold">{props.consent[k] ? l.yes : l.no}</dd>
          </div>
        ))}
      </dl>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const body = Object.fromEntries(CONSENT_KEYS.map((k) => [k, f.get(k) === "on"]));
    if (await submit("PUT", props.url, body)) setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">{l.saved}</Alert>}
      {CONSENT_KEYS.map((k) => (
        <label key={k} className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border bg-surface transition hover:border-primary px-4">
          <input type="checkbox" name={k} defaultChecked={props.consent[k]} className="size-6" />
          {l[k]}
        </label>
      ))}
      <Button type="submit" busy={pending} className="self-start">
        {l.save}
      </Button>
    </form>
  );
}
