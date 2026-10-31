import type { ReactNode } from "react";

const tones = {
  error: "border-danger text-danger",
  success: "border-success text-success",
  info: "border-primary text-foreground",
};

/** Announced to screen readers: errors interrupt (role=alert), others are polite (role=status). */
export function Alert({ tone = "info", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border-l-4 bg-surface px-4 py-3 font-medium ${tones[tone]}`}>
      {children}
    </div>
  );
}
