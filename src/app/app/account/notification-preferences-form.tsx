"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

export function NotificationPreferencesForm(props: {
  preferences: { emailEnabled: boolean; quietStart: string | null; quietEnd: string | null; digestEnabled: boolean };
  labels: Record<"network" | "generic" | "fixErrors" | "email" | "digest" | "digestHint" | "quietTitle" | "quietIntro" | "quietStart" | "quietEnd" | "save" | "saved", string>;
}) {
  const { labels: l, preferences: p } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const time = (k: string) => String(f.get(k) ?? "") || null;
    const ok = await submit("PUT", "/api/v1/me/notification-preferences", {
      emailEnabled: f.get("emailEnabled") === "on",
      digestEnabled: f.get("digestEnabled") === "on",
      quietStart: time("quietStart"),
      quietEnd: time("quietEnd"),
    });
    if (ok) setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex max-w-xl flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">{l.saved}</Alert>}
      <label className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border bg-surface transition hover:border-primary px-4">
        <input type="checkbox" name="emailEnabled" defaultChecked={p.emailEnabled} className="size-6" />
        {l.email}
      </label>
      <label className="flex min-h-12 items-start gap-3 rounded-xl border-2 border-border bg-surface px-4 py-3 transition hover:border-primary">
        <input type="checkbox" name="digestEnabled" defaultChecked={p.digestEnabled} className="mt-1 size-6 shrink-0" />
        <span>
          {l.digest}
          <span className="block text-base text-muted">
            {l.digestHint}
          </span>
        </span>
      </label>
      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold">{l.quietTitle}</legend>
        <p className="text-muted">{l.quietIntro}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={l.quietStart} name="quietStart" type="time" defaultValue={p.quietStart ?? ""} errors={fieldErrors.quietStart} />
          <TextField label={l.quietEnd} name="quietEnd" type="time" defaultValue={p.quietEnd ?? ""} errors={fieldErrors.quietEnd} />
        </div>
      </fieldset>
      <Button type="submit" busy={pending} className="self-start">
        {l.save}
      </Button>
    </form>
  );
}
