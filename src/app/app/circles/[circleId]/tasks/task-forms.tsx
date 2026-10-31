"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";
import { isoToZonedInput, zonedInputToIso } from "@/lib/zoned";

type Option = { value: string; label: string };
const textareaClass = "min-h-20 w-full rounded-lg border-2 border-border bg-surface p-3 text-lg";

export function TaskForm(props: {
  method: "POST" | "PATCH";
  url: string;
  timeZone: string;
  initial?: {
    title: string;
    notes: string | null;
    category: string;
    assignee: { memberId: string } | null;
    dueAt: Date | string | null;
    priority: string;
    recurrence: string;
    version: number;
  };
  openLabel: string;
  labels: Record<string, string>;
  options: { categories: Option[]; priorities: Option[]; recurrences: Option[]; assignees: Option[] };
}) {
  const { labels: l, initial, options } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit({ network: l.network, generic: l.generic, fixErrors: l.fixErrors });
  const [open, setOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const body: Record<string, unknown> = {
      title: s("title"),
      notes: s("notes"),
      category: s("category"),
      priority: s("priority"),
      recurrence: s("recurrence"),
      dueAt: zonedInputToIso(s("dueAt"), props.timeZone),
    };
    // Only send an assignee if the field is shown (it needs permission to list members).
    if (options.assignees.length > 1) body.assigneeMemberId = s("assigneeMemberId") || null;
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
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{l.notes}</span>
        <textarea name="notes" defaultValue={initial?.notes ?? ""} className={textareaClass} maxLength={2000} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label={l.category} name="category" defaultValue={initial?.category ?? "other"} options={options.categories} />
        <SelectField label={l.priority} name="priority" defaultValue={initial?.priority ?? "normal"} options={options.priorities} />
      </div>
      <TextField label={l.dueAt} name="dueAt" type="datetime-local" defaultValue={isoToZonedInput(initial?.dueAt ?? null, props.timeZone)} errors={fieldErrors.dueAt} />
      <SelectField label={l.recurrence} name="recurrence" defaultValue={initial?.recurrence ?? "none"} options={options.recurrences} />
      {options.assignees.length > 1 && (
        <SelectField
          label={l.assignee}
          name="assigneeMemberId"
          defaultValue={initial?.assignee?.memberId ?? ""}
          options={options.assignees}
          errors={fieldErrors.assigneeMemberId ?? fieldErrors.memberId}
        />
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

export function CompleteTaskForm(props: { url: string; labels: Record<string, string> }) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit({ network: l.network, generic: l.generic, fixErrors: l.fixErrors });
  const [open, setOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await submit("POST", props.url, { note: String(new FormData(event.currentTarget).get("note") ?? "") });
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
    <form onSubmit={onSubmit} className="flex w-full max-w-xl flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{l.note}</span>
        <textarea name="note" className={textareaClass} maxLength={2000} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={pending}>
          ✓ {l.save}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {l.cancel}
        </Button>
      </div>
    </form>
  );
}
