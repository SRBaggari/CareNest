"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Option = { value: string; label: string };
type Messages = { network: string; generic: string; fixErrors: string };

export function InviteForm(props: {
  url: string;
  roleOptions: Option[];
  roleHints: Record<string, string>;
  labels: Messages & Record<"email" | "role" | "temporary" | "temporaryHint" | "submit" | "created" | "copy" | "copied", string>;
}) {
  const { labels } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(labels);
  const [role, setRole] = useState(props.roleOptions.find((o) => o.value === "family")?.value ?? props.roleOptions[0].value);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLink(null);
    setCopied(false);
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    const until = String(f.get("accessExpiresAt") ?? "");
    const result = await submit<{ inviteUrl: string }>("POST", props.url, {
      email: String(f.get("email") ?? ""),
      role,
      // <input type="datetime-local"> is in the inviter's local time; send it as an absolute instant.
      accessExpiresAt: until ? new Date(until).toISOString() : null,
    });
    if (result) {
      setLink(result.inviteUrl);
      formEl.reset();
      router.refresh();
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex max-w-xl flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      {link && (
        <Alert tone="success">
          <p>{labels.created}</p>
          <p className="mt-2 break-all rounded bg-background p-2 font-mono text-base">{link}</p>
          <Button type="button" variant="secondary" className="mt-2" onClick={copy}>
            {labels.copy}
          </Button>
          {copied && <p className="mt-1">{labels.copied}</p>}
        </Alert>
      )}
      <TextField label={labels.email} name="email" type="email" autoComplete="off" required errors={fieldErrors.email} />
      <SelectField
        label={labels.role}
        hint={props.roleHints[role]}
        name="role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        options={props.roleOptions}
        errors={fieldErrors.role}
      />
      <TextField
        label={labels.temporary}
        hint={labels.temporaryHint}
        name="accessExpiresAt"
        type="datetime-local"
        errors={fieldErrors.accessExpiresAt}
      />
      <Button type="submit" busy={pending} className="self-start">
        {labels.submit}
      </Button>
    </form>
  );
}

export function MemberRoleForm(props: {
  url: string;
  role: string;
  options: Option[];
  labels: Messages & { changeRole: string; save: string };
}) {
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit(props.labels);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const role = String(new FormData(event.currentTarget).get("role"));
    await submit("PATCH", props.url, { role });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <SelectField label={props.labels.changeRole} name="role" defaultValue={props.role} options={props.options} />
        <Button type="submit" variant="secondary" busy={pending}>
          {props.labels.save}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}
