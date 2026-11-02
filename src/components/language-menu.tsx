"use client";

import { Check, Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/api-client";

/**
 * One tap to change language, beside "Sign out". Each language is written in its own script
 * (English, हिन्दी, తెలుగు, தமிழ்), so anyone can find theirs whatever the screen is showing now.
 */
export function LanguageMenu({
  current,
  options,
  label,
  className,
  align = "right",
}: {
  current: string;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
  align?: "left" | "right";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Closes on Escape or a tap anywhere else.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function choose(locale: string) {
    setOpen(false);
    if (locale === current) return;
    setBusy(true);
    await callApi("PATCH", "/api/v1/me", { locale });
    router.refresh();
    setBusy(false);
  }

  const currentLabel = options.find((o) => o.value === current)?.label ?? current;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={() => setOpen(!open)}
        className={`${className ?? ""} w-full`}
      >
        <Languages aria-hidden="true" className="size-5 shrink-0" />
        <span className="sr-only">{label}: </span>
        {currentLabel}
      </button>
      {open && (
        <ul className={`absolute top-full z-40 mt-2 flex min-w-48 flex-col gap-1 rounded-2xl border-2 border-border bg-surface p-2 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                lang={o.value}
                aria-current={o.value === current || undefined}
                onClick={() => choose(o.value)}
                className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-4 text-left text-lg font-semibold hover:bg-sunken ${o.value === current ? "bg-primary-soft text-primary" : ""}`}
              >
                {o.label}
                {o.value === current && <Check aria-hidden="true" className="size-5 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
