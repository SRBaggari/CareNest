"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/api-client";

export function SignOutButton({ label, className }: { label: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await callApi("POST", "/api/v1/auth/logout");
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy || undefined}
      className={className ?? "inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-border px-4 font-semibold hover:border-primary hover:text-primary"}
    >
      <LogOut aria-hidden="true" className="size-5" />
      <span>{label}</span>
    </button>
  );
}
