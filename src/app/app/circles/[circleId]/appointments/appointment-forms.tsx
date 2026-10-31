"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";
import { isoToZonedInput, zonedInputToIso } from "@/lib/zoned";

const textareaClass = "min-h-24 w-full rounded-lg border-2 border-border bg-surface p-3 text-lg";

type Initial = {
  title: string;
  kind: "in_person" | "virtual" | "home_visit";
  clinician: string | null;
  location: string | null;
  virtualUrl: string | null;
  startsAt: Date | string;
  endsAt: Date | string | null;
  reason: string | null;
  questions: string | null;
  transportNeeded: boolean;
  version: number;
};

export function AppointmentForm(props: {
  method: "POST" | "PATCH";
  url: string;
  timeZone: string;
  initial?: Initial;
  openLabel: string;
  labels: Record<string, string>;
}) {
  const { labels: l, initial } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit({ network: l.network, generic: l.generic, fixErrors: l.fixErrors });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Initial["kind"]>(initial?.kind ?? "in_person");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const body: Record<string, unknown> = {
      title: s("title"),
      kind,
      clinician: s("clinician"),
      location: s("location"),
      virtualUrl: s("virtualUrl"),
      // Typed in the recipient's local time, whatever zone this browser is in.
      startsAt: zonedInputToIso(s("startsAt"), props.timeZone) ?? "",
      endsAt: zonedInputToIso(s("endsAt"), props.timeZone),
      reason: s("reason"),
      questions: s("questions"),
      transportNeeded: f.get("transportNeeded") === "on",
    };
    if (initial) body.version = initial.version;
    const ok = await submit(props.method, props.url, body);
    if (ok) setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" variant={initial ? "secondary" : "primary"} className="self-start" onClick={() => setOpen(true)}>
        {props.openLabel}
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-2xl flex-col gap-5 rounded-xl border-2 border-primary bg-surface p-5">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={l.title} hint={l.titleHint} name="title" defaultValue={initial?.title} required errors={fieldErrors.title} />
      <SelectField
        label={l.kind}
        name="kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as Initial["kind"])}
        options={["in_person", "virtual", "home_visit"].map((k) => ({ value: k, label: l[`kind_${k}`] }))}
      />
      <TextField label={l.startsAt} name="startsAt" type="datetime-local" defaultValue={isoToZonedInput(initial?.startsAt ?? null, props.timeZone)} required errors={fieldErrors.startsAt} />
      <TextField label={l.endsAt} name="endsAt" type="datetime-local" defaultValue={isoToZonedInput(initial?.endsAt ?? null, props.timeZone)} errors={fieldErrors.endsAt} />
      <TextField label={l.clinician} name="clinician" defaultValue={initial?.clinician ?? ""} errors={fieldErrors.clinician} />
      {kind !== "virtual" && <TextField label={l.location} name="location" defaultValue={initial?.location ?? ""} errors={fieldErrors.location} />}
      {kind === "virtual" && <TextField label={l.virtualUrl} name="virtualUrl" type="url" defaultValue={initial?.virtualUrl ?? ""} errors={fieldErrors.virtualUrl} />}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{l.reason}</span>
        <textarea name="reason" defaultValue={initial?.reason ?? ""} className={textareaClass} maxLength={1000} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{l.questions}</span>
        <span className="text-muted">{l.questionsHint}</span>
        <textarea name="questions" defaultValue={initial?.questions ?? ""} className={textareaClass} maxLength={4000} />
      </label>
      {kind === "in_person" && (
        <label className="flex min-h-12 items-center gap-3 rounded-lg border-2 border-border px-4">
          <input type="checkbox" name="transportNeeded" defaultChecked={initial?.transportNeeded ?? true} className="size-6" />
          {l.transportNeeded}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={pending}>
          {l.save}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {l.cancel}
        </Button>
      </div>
    </form>
  );
}

export function OutcomeForm(props: { url: string; labels: Record<string, string> }) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit({ network: l.network, generic: l.generic, fixErrors: l.fixErrors });
  const [open, setOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const followUpTasks = String(f.get("followUpTasks") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((title) => ({ title }));
    const ok = await submit("POST", props.url, {
      outcomeNote: String(f.get("outcomeNote") ?? ""),
      followUp: String(f.get("followUp") ?? ""),
      followUpTasks,
    });
    if (ok) setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {l.open}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border-2 border-primary bg-surface p-5">
      {error && <Alert tone="error">{error}</Alert>}
      {(["outcomeNote", "followUp"] as const).map((k) => (
        <label key={k} className="flex flex-col gap-1">
          <span className="font-semibold">{l[k]}</span>
          <textarea name={k} className={textareaClass} maxLength={k === "outcomeNote" ? 4000 : 2000} />
        </label>
      ))}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{l.followUpTasks}</span>
        <span className="text-muted">{l.followUpTasksHint}</span>
        <textarea name="followUpTasks" className={textareaClass} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={pending}>
          {l.save}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {l.cancel}
        </Button>
      </div>
    </form>
  );
}
