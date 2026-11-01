"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Option = { value: string; label: string };
type CommonLabels = { network: string; generic: string; fixErrors: string; save: string; saved: string };

export function ProfileForm(props: {
  user: { name: string; locale: string; timeZone: string };
  timeZones: Option[];
  locales: Option[];
  labels: CommonLabels & { name: string; timeZone: string; language: string };
}) {
  const { labels } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(labels, { confirm: false });
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const ok = await submit("PATCH", "/api/v1/me", {
      name: String(form.get("name") ?? ""),
      timeZone: String(form.get("timeZone") ?? ""),
      locale: String(form.get("locale") ?? ""),
    });
    if (ok) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex max-w-xl flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">{labels.saved}</Alert>}
      <TextField label={labels.name} name="name" defaultValue={props.user.name} autoComplete="name" errors={fieldErrors.name} />
      <SelectField label={labels.timeZone} name="timeZone" defaultValue={props.user.timeZone} options={props.timeZones} errors={fieldErrors.timeZone} />
      <SelectField label={labels.language} name="locale" defaultValue={props.user.locale} options={props.locales} errors={fieldErrors.locale} />
      <Button type="submit" busy={pending} className="self-start">
        {labels.save}
      </Button>
    </form>
  );
}

export function PasswordForm({
  labels,
}: {
  labels: CommonLabels & { currentPassword: string; newPassword: string; passwordHint: string; submit: string; changed: string };
}) {
  const { pending, error, fieldErrors, submit } = useApiSubmit(labels);
  const [changed, setChanged] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChanged(false);
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const ok = await submit("POST", "/api/v1/me/password", {
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword: String(form.get("newPassword") ?? ""),
    });
    if (ok !== null) {
      formEl.reset();
      setChanged(true);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex max-w-xl flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      {changed && <Alert tone="success">{labels.changed}</Alert>}
      <TextField
        label={labels.currentPassword}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        errors={fieldErrors.currentPassword}
      />
      <TextField
        label={labels.newPassword}
        hint={labels.passwordHint}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        errors={fieldErrors.newPassword}
      />
      <Button type="submit" busy={pending} className="self-start">
        {labels.submit}
      </Button>
    </form>
  );
}

export function DeviceList({
  devices,
  labels,
}: {
  devices: { id: string; current: boolean; description: string; lastActive: string }[];
  labels: CommonLabels & { thisDevice: string; signOutDevice: string };
}) {
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit(labels);

  async function revoke(id: string) {
    const ok = await submit("DELETE", `/api/v1/me/sessions/${id}`);
    if (ok !== null) router.refresh();
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <ul className="flex flex-col gap-3">
        {devices.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div>
              <p className="font-medium break-all">{d.description}</p>
              <p className="text-muted">{d.current ? labels.thisDevice : d.lastActive}</p>
            </div>
            {!d.current && (
              <Button variant="secondary" busy={pending} onClick={() => revoke(d.id)}>
                {labels.signOutDevice}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
