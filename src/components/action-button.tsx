"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApiSubmit } from "@/lib/api-client";

/**
 * A button that calls one API endpoint, optionally after a confirmation, then refreshes the page
 * (or navigates). Errors are announced next to the button.
 */
export function ActionButton(props: {
  method: string;
  url: string;
  body?: unknown;
  confirm?: string;
  redirectTo?: string;
  variant?: "primary" | "secondary" | "danger";
  messages: { network: string; generic: string; fixErrors: string };
  children: ReactNode;
}) {
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit(props.messages);

  async function run() {
    if (props.confirm && !window.confirm(props.confirm)) return;
    const result = await submit(props.method, props.url, props.body);
    if (result === null) {
      router.refresh();
      return;
    }
    if (props.redirectTo) router.replace(props.redirectTo);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant={props.variant ?? "secondary"} busy={pending} onClick={run}>
        {props.children}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
