"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApiSubmit } from "@/lib/api-client";

const KINDS = ["doseReminders", "unconfirmedDoses", "refills"] as const;

export function AlertSettingsForm(props: {
  url: string;
  settings: Record<(typeof KINDS)[number], boolean>;
  labels: Record<(typeof KINDS)[number] | "network" | "generic" | "fixErrors" | "save" | "saved", string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit(l);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    if (await submit("PUT", props.url, Object.fromEntries(KINDS.map((k) => [k, f.get(k) === "on"])))) setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">{l.saved}</Alert>}
      {KINDS.map((k) => (
        <label key={k} className="flex min-h-12 items-center gap-3 rounded-lg border-2 border-border px-4">
          <input type="checkbox" name={k} defaultChecked={props.settings[k]} className="size-6" />
          {l[k]}
        </label>
      ))}
      <Button type="submit" busy={pending} className="self-start">
        {l.save}
      </Button>
    </form>
  );
}
