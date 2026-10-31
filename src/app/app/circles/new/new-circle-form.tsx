"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Option = { value: string; label: string };

export function NewCircleForm(props: {
  labels: Record<string, string>;
  timeZones: Option[];
  countries: Option[];
  locales: Option[];
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit({ network: l.network, generic: l.generic, fixErrors: l.fixErrors });
  const [creatorRole, setCreatorRole] = useState<"admin" | "care_recipient">("admin");
  const timeZoneRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZoneRef.current && props.timeZones.some((z) => z.value === zone)) timeZoneRef.current.value = zone;
  }, [props.timeZones]);

  const r = (field: string) => fieldErrors[`recipient.${field}`];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "").trim();
    const result = await submit<{ circle: { id: string } }>("POST", "/api/v1/circles", {
      name: str("name"),
      creatorRole,
      recipient: {
        displayName: str("displayName"),
        preferredName: str("preferredName"),
        dateOfBirth: str("dateOfBirth") || null,
        timeZone: str("timeZone"),
        country: str("country"),
        locale: str("locale"),
        selfManaging: creatorRole === "care_recipient" || f.get("selfManaging") !== "no",
      },
    });
    if (result) router.push(`/app/circles/${result.circle.id}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-6">
      {error && <Alert tone="error">{error}</Alert>}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">{l.whoCreates}</legend>
        {(["admin", "care_recipient"] as const).map((role) => (
          <label key={role} className="flex min-h-12 items-center gap-3 rounded-lg border-2 border-border bg-surface px-4">
            <input
              type="radio"
              name="creatorRole"
              value={role}
              checked={creatorRole === role}
              onChange={() => setCreatorRole(role)}
              className="size-6"
            />
            {role === "admin" ? l.creatorAdmin : l.creatorSelf}
          </label>
        ))}
      </fieldset>

      <TextField label={l.circleName} hint={l.circleNameHint} name="name" required errors={fieldErrors.name} />
      <TextField label={l.recipientName} name="displayName" autoComplete="off" required errors={r("displayName")} />
      <TextField label={`${l.preferredName} (${l.optional})`} hint={l.preferredNameHint} name="preferredName" errors={r("preferredName")} />
      <TextField label={`${l.dateOfBirth} (${l.optional})`} name="dateOfBirth" type="date" errors={r("dateOfBirth")} />
      <SelectField ref={timeZoneRef} label={l.timeZone} hint={l.timeZoneHint} name="timeZone" defaultValue="Asia/Kolkata" options={props.timeZones} errors={r("timeZone")} />
      <SelectField label={l.country} hint={l.countryHint} name="country" defaultValue="IN" options={props.countries} errors={r("country")} />
      <SelectField label={l.language} name="locale" defaultValue="en" options={props.locales} errors={r("locale")} />

      {creatorRole === "admin" && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold">{l.selfManaging}</legend>
          <p className="text-muted">{l.selfManagingHint}</p>
          {[
            { value: "yes", label: l.selfManagingYes },
            { value: "no", label: l.selfManagingNo },
          ].map((o) => (
            <label key={o.value} className="flex min-h-12 items-center gap-3 rounded-lg border-2 border-border bg-surface px-4">
              <input type="radio" name="selfManaging" value={o.value} defaultChecked={o.value === "yes"} className="size-6" />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}

      <Button type="submit" busy={pending} className="self-start">
        {l.create}
      </Button>
    </form>
  );
}
