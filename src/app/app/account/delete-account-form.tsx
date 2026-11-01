"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

/** Deliberately slow to use: password + typing DELETE, then a final browser confirmation. */
export function DeleteAccountForm({ labels: l }: { labels: Record<"password" | "confirmLabel" | "deleteButton" | "network" | "generic" | "fixErrors", string> }) {
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  const [typed, setTyped] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(l.deleteButton + "?")) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await submit("DELETE", "/api/v1/me", { password, confirm: typed });
    // 204: the server has signed us out; leave the app entirely.
    if (result !== null) {
      router.replace("/?deleted=1");
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex max-w-xl flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={l.password} name="password" type="password" autoComplete="current-password" errors={fieldErrors.password} />
      <TextField label={l.confirmLabel} name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" errors={fieldErrors.confirm} />
      <Button type="submit" variant="danger" busy={pending} disabled={typed !== "DELETE"} className="self-start">
        {l.deleteButton}
      </Button>
    </form>
  );
}
