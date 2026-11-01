import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";

const tones = {
  error: { box: "border-danger bg-danger-soft text-danger", Icon: CircleAlert },
  success: { box: "border-success bg-success-soft text-success", Icon: CircleCheck },
  info: { box: "border-primary bg-primary-soft text-foreground", Icon: Info },
};

/** Announced to screen readers: errors interrupt (role=alert), others are polite (role=status). */
export function Alert({ tone = "info", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  const { box, Icon } = tones[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border-l-4 px-4 py-3 font-medium ${box}`}>
      <Icon aria-hidden="true" className="mt-1 size-5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
