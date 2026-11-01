import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconTile } from "./section";

/** What a list shows when there is nothing in it yet: calm, clearly intentional, never an error. */
export function EmptyState({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border-2 border-dashed border-border px-5 py-6">
      <IconTile icon={icon} tone="neutral" />
      <p className="min-w-0 text-muted">{children}</p>
    </div>
  );
}
