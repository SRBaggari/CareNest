"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { DONE_EVENT } from "@/lib/api-client";

/**
 * A short "Done." after any change, so people know their tap worked even when the change itself
 * is somewhere else on the page. The live region is always present (empty when hidden) so screen
 * readers announce each confirmation.
 */
export function Toaster({ label }: { label: string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const onDone = () => setShown((n) => n + 1);
    window.addEventListener(DONE_EVENT, onDone);
    return () => window.removeEventListener(DONE_EVENT, onDone);
  }, []);

  useEffect(() => {
    if (shown === 0) return;
    const timer = window.setTimeout(() => setShown(0), 3500);
    return () => window.clearTimeout(timer);
  }, [shown]);

  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-4 lg:bottom-8">
      {shown > 0 && (
        <span key={shown} className="animate-rise inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 font-semibold text-background shadow-lg">
          <CircleCheck aria-hidden="true" className="size-5 shrink-0" />
          {label}
        </span>
      )}
    </div>
  );
}
