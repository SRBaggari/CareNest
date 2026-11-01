"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";
import { zonedInputToIso } from "@/lib/zoned";

export type SimpleField =
  | { name: string; type: "text" | "textarea"; label: string; hint?: string; required?: boolean; maxLength?: number; defaultValue?: string }
  | { name: string; type: "select"; label: string; hint?: string; options: { value: string; label: string }[]; defaultValue?: string }
  | { name: string; type: "checkbox"; label: string; defaultChecked?: boolean }
  /** A date-time typed in `timeZone` (the care recipient's), sent as an ISO instant. */
  | { name: string; type: "zoned-datetime"; label: string; hint?: string; required?: boolean };

const textareaClass = "min-h-24 w-full rounded-xl border-2 border-border bg-surface px-4 focus:border-primary text-lg";

/**
 * A small form described by data, so server components can render it: a button opens it, it
 * posts JSON to one endpoint, shows field errors next to fields, then refreshes the page.
 */
export function SimpleForm(props: {
  method: "POST" | "PUT" | "PATCH";
  url: string;
  fields: SimpleField[];
  /** Extra values sent with every submission (e.g. ids). */
  fixed?: Record<string, unknown>;
  timeZone?: string;
  openLabel?: string;
  submitLabel: string;
  cancelLabel: string;
  variant?: "primary" | "secondary" | "danger";
  messages: { network: string; generic: string; fixErrors: string };
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(props.messages);
  const [open, setOpen] = useState(!props.openLabel);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    const body: Record<string, unknown> = { ...props.fixed };
    for (const field of props.fields) {
      const raw = String(f.get(field.name) ?? "").trim();
      if (field.type === "checkbox") body[field.name] = f.get(field.name) === "on";
      else if (field.type === "zoned-datetime") body[field.name] = zonedInputToIso(raw, props.timeZone ?? "UTC");
      else body[field.name] = raw;
    }
    const ok = await submit(props.method, props.url, body);
    if (ok !== null) {
      formEl.reset();
      if (props.openLabel) setOpen(false);
    }
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" variant={props.variant ?? "secondary"} className="self-start" onClick={() => setOpen(true)}>
        {props.openLabel}
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-2xl flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      {props.fields.map((field) => {
        const errors = fieldErrors[field.name];
        switch (field.type) {
          case "textarea":
            return (
              <label key={field.name} className="flex flex-col gap-1">
                <span className="font-semibold">{field.label}</span>
                {field.hint && <span className="text-muted">{field.hint}</span>}
                <textarea
                  name={field.name}
                  defaultValue={field.defaultValue}
                  required={field.required}
                  maxLength={field.maxLength}
                  aria-invalid={Boolean(errors)}
                  className={textareaClass}
                />
                {errors && <span className="font-medium text-danger">{errors.join(" ")}</span>}
              </label>
            );
          case "select":
            return <SelectField key={field.name} label={field.label} hint={field.hint} name={field.name} defaultValue={field.defaultValue} options={field.options} errors={errors} />;
          case "checkbox":
            return (
              <label key={field.name} className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border bg-surface transition hover:border-primary px-4">
                <input type="checkbox" name={field.name} defaultChecked={field.defaultChecked} className="size-6" />
                {field.label}
              </label>
            );
          case "zoned-datetime":
            return <TextField key={field.name} label={field.label} hint={field.hint} name={field.name} type="datetime-local" required={field.required} errors={errors} />;
          default:
            return <TextField key={field.name} label={field.label} hint={field.hint} name={field.name} defaultValue={field.defaultValue} required={field.required} maxLength={field.maxLength} errors={errors} />;
        }
      })}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={props.variant === "danger" ? "danger" : "primary"} busy={pending}>
          {props.submitLabel}
        </Button>
        {props.openLabel && (
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {props.cancelLabel}
          </Button>
        )}
      </div>
    </form>
  );
}
