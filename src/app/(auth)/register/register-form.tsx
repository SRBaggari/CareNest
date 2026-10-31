"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Option = { value: string; label: string };
type Labels = Record<
  | "name"
  | "email"
  | "password"
  | "passwordHint"
  | "timeZone"
  | "timeZoneHint"
  | "language"
  | "submit"
  | "network"
  | "generic"
  | "fixErrors",
  string
>;

export function RegisterForm(props: {
  next: string;
  defaultLocale: string;
  timeZones: Option[];
  locales: Option[];
  labels: Labels;
}) {
  const { labels } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(labels);
  const timeZoneRef = useRef<HTMLSelectElement>(null);

  // Pre-select the browser's time zone once on the client (the server can't know it).
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const select = timeZoneRef.current;
    if (select && browserZone && props.timeZones.some((z) => z.value === browserZone)) select.value = browserZone;
  }, [props.timeZones]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await submit("POST", "/api/v1/auth/register", {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      timeZone: String(form.get("timeZone") ?? "UTC"),
      locale: String(form.get("locale") ?? "en"),
    });
    if (ok) {
      router.replace(props.next);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={labels.name} name="name" autoComplete="name" required errors={fieldErrors.name} />
      <TextField label={labels.email} name="email" type="email" autoComplete="email" required errors={fieldErrors.email} />
      <TextField
        label={labels.password}
        hint={labels.passwordHint}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        errors={fieldErrors.password}
      />
      <SelectField
        ref={timeZoneRef}
        label={labels.timeZone}
        hint={labels.timeZoneHint}
        name="timeZone"
        defaultValue="UTC"
        options={props.timeZones}
        errors={fieldErrors.timeZone}
      />
      <SelectField
        label={labels.language}
        name="locale"
        defaultValue={props.defaultLocale}
        options={props.locales}
        errors={fieldErrors.locale}
      />
      <Button type="submit" busy={pending}>
        {labels.submit}
      </Button>
    </form>
  );
}
