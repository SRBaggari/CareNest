"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Labels = { email: string; password: string; submit: string; network: string; generic: string; fixErrors: string };

export function LoginForm({ next, labels }: { next: string; labels: Labels }) {
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(labels);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await submit("POST", "/api/v1/auth/login", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (ok) {
      router.replace(next);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={labels.email} name="email" type="email" autoComplete="email" required errors={fieldErrors.email} />
      <TextField
        label={labels.password}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        errors={fieldErrors.password}
      />
      <Button type="submit" busy={pending}>
        {labels.submit}
      </Button>
    </form>
  );
}
