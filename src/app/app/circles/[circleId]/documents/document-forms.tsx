"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";

type Messages = { network: string; generic: string; fixErrors: string };
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

/** Posts a multipart form; returns field errors (or a general error) the way the JSON forms do. */
function useUpload(messages: Messages) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function send(url: string, form: FormData) {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(url, { method: "POST", body: form });
      if (res.ok) return true;
      const body = await res.json().catch(() => null);
      const details = body?.error?.details;
      if (details && typeof details === "object") {
        setFieldErrors(details);
        setError(messages.fixErrors);
      } else setError(body?.error?.message || messages.generic);
      return false;
    } catch {
      setError(messages.network);
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, error, fieldErrors, send };
}

function FileField({ label, errors }: { label: string; errors?: string[] }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        id={id}
        name="file"
        type="file"
        accept={ACCEPT}
        required
        aria-invalid={Boolean(errors?.length)}
        aria-describedby={errors?.length ? `${id}-error` : undefined}
        className="min-h-12 w-full min-w-0 rounded-xl border-2 border-dashed border-border bg-surface p-3 text-base file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-primary-soft file:px-4 file:font-semibold file:text-primary"
      />
      {errors?.length ? (
        <p id={`${id}-error`} className="font-medium text-danger">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function UploadDocumentForm(props: {
  url: string;
  categories: { value: string; label: string }[];
  labels: Messages & Record<"file" | "name" | "nameHint" | "category" | "note" | "save" | "uploaded", string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, send } = useUpload(l);
  const [done, setDone] = useState(false);
  const [formKey, setFormKey] = useState(0);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(false);
    if (await send(props.url, new FormData(event.currentTarget))) {
      setDone(true);
      setFormKey((k) => k + 1);
      router.refresh();
    }
  }
  return (
    <form key={formKey} onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
      {done && <Alert tone="success">{l.uploaded}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <FileField label={l.file} errors={fieldErrors.file} />
      <TextField label={l.name} hint={l.nameHint} name="title" maxLength={120} required errors={fieldErrors.title} />
      <SelectField label={l.category} name="category" defaultValue="report" options={props.categories} errors={fieldErrors.category} />
      <TextField label={l.note} name="note" maxLength={500} errors={fieldErrors.note} />
      <Button type="submit" busy={pending} className="self-start">
        <Upload aria-hidden="true" className="size-5" />
        {l.save}
      </Button>
    </form>
  );
}

/** "Upload a newer copy", tucked inside the document's details so the list stays calm. */
export function NewVersionForm(props: { url: string; labels: Messages & Record<"file" | "note" | "save" | "versionSaved", string>; children?: ReactNode }) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, send } = useUpload(l);
  const [done, setDone] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(false);
    if (await send(props.url, new FormData(event.currentTarget))) {
      setDone(true);
      event.currentTarget?.reset();
      router.refresh();
    }
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      {done && <Alert tone="success">{l.versionSaved}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <FileField label={l.file} errors={fieldErrors.file} />
      <TextField label={l.note} name="note" maxLength={500} errors={fieldErrors.note} />
      <Button type="submit" variant="secondary" busy={pending} className="self-start">
        <Upload aria-hidden="true" className="size-5" />
        {l.save}
      </Button>
    </form>
  );
}
