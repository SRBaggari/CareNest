"use client";

import { MessageSquarePlus, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Messages = { network: string; generic: string; fixErrors: string };
type Person = { memberId: string; name: string };

/** "Let these people know": a short list of names with checkboxes (nobody is ticked by default). */
function NotifyPicker({ people, label, hint }: { people: Person[]; label: string; hint: string }) {
  if (people.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-semibold">{label}</legend>
      <p className="text-base text-muted">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {people.map((p) => (
          <label key={p.memberId} className="inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-border bg-surface px-3 transition hover:border-primary">
            <input type="checkbox" name="notify" value={p.memberId} className="size-5" />
            {p.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const textarea = "min-h-28 w-full rounded-xl border-2 border-border bg-surface p-3 text-lg focus:border-primary aria-[invalid=true]:border-danger";

export function StartThreadForm(props: {
  url: string;
  circleId: string;
  people: Person[];
  labels: Messages & Record<"subject" | "subjectHint" | "message" | "notify" | "notifyHint" | "start", string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const result = await submit<{ thread: { id: string } }>("POST", props.url, {
      title: String(f.get("title") ?? ""),
      body: String(f.get("body") ?? ""),
      notify: f.getAll("notify").map(String),
    });
    if (result) router.push(`/app/circles/${props.circleId}/messages/${result.thread.id}`);
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={l.subject} hint={l.subjectHint} name="title" maxLength={120} required errors={fieldErrors.title} />
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{l.message}</span>
        <textarea name="body" maxLength={4000} required aria-invalid={Boolean(fieldErrors.body?.length)} className={textarea} />
        {fieldErrors.body && <span className="font-medium text-danger">{fieldErrors.body.join(" ")}</span>}
      </label>
      <NotifyPicker people={props.people} label={l.notify} hint={l.notifyHint} />
      {fieldErrors.notify && <p className="font-medium text-danger">{fieldErrors.notify.join(" ")}</p>}
      <Button type="submit" busy={pending} className="self-start">
        <MessageSquarePlus aria-hidden="true" className="size-5" />
        {l.start}
      </Button>
    </form>
  );
}

export function ReplyForm(props: { url: string; people: Person[]; labels: Messages & Record<"reply" | "notify" | "notifyHint" | "send", string> }) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  const [formKey, setFormKey] = useState(0);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const ok = await submit("POST", props.url, { body: String(f.get("body") ?? ""), notify: f.getAll("notify").map(String) });
    if (ok) {
      setFormKey((k) => k + 1);
      router.refresh();
    }
  }
  return (
    <form key={formKey} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{l.reply}</span>
        <textarea name="body" maxLength={4000} required aria-invalid={Boolean(fieldErrors.body?.length)} className={textarea} />
        {fieldErrors.body && <span className="font-medium text-danger">{fieldErrors.body.join(" ")}</span>}
      </label>
      <NotifyPicker people={props.people} label={l.notify} hint={l.notifyHint} />
      {fieldErrors.notify && <p className="font-medium text-danger">{fieldErrors.notify.join(" ")}</p>}
      <Button type="submit" busy={pending} className="self-start">
        <Send aria-hidden="true" className="size-5" />
        {l.send}
      </Button>
    </form>
  );
}

/** "Discuss" on an appointment or task: opens its conversation, starting it if needed. */
export function DiscussButton(props: { url: string; circleId: string; subjectType: "appointment" | "task"; subjectId: string; label: string; messages: Messages }) {
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit(props.messages);
  async function go() {
    const result = await submit<{ thread: { id: string } }>("POST", props.url, { subjectType: props.subjectType, subjectId: props.subjectId });
    if (result) router.push(`/app/circles/${props.circleId}/messages/${result.thread.id}`);
  }
  return (
    <>
      <Button type="button" variant="secondary" busy={pending} onClick={go}>
        <MessageSquarePlus aria-hidden="true" className="size-5" />
        {props.label}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  );
}
