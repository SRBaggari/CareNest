import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export type Tone = "primary" | "success" | "warning" | "danger" | "neutral";

const toneTile: Record<Tone, string> = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-sunken text-muted",
};

/** A rounded, tinted square holding an icon. Purely decorative. */
export function IconTile({ icon: Icon, tone = "primary", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "md" | "lg" }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-xl ${toneTile[tone]} ${size === "lg" ? "size-12" : "size-10"}`}>
      <Icon className={size === "lg" ? "size-6" : "size-5"} strokeWidth={2.2} />
    </span>
  );
}

/** A card with an icon heading and an optional "See all" style link in its top corner. */
export function SectionCard({
  id,
  icon,
  tone,
  title,
  action,
  className = "",
  children,
}: {
  id: string;
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  action?: { href: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`card flex min-w-0 flex-col gap-4 ${className}`}>
      {/* The link drops below the title when both don't fit (long words in Tamil, Telugu). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <IconTile icon={icon} tone={tone} />
        <h3 id={id} className="min-w-0 flex-1 basis-40 text-xl font-bold">
          {title}
        </h3>
        {action && (
          <Link href={action.href} className="ml-auto inline-flex min-h-12 items-center gap-1 rounded-lg px-2 font-semibold text-primary hover:underline">
            {action.label}
            <ChevronRight aria-hidden="true" className="size-5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const badgeTone: Record<Tone, string> = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-sunken text-muted",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-base font-semibold ${badgeTone[tone]}`}>{children}</span>;
}

/** Initials in a soft circle, standing in for a photo. */
export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => [...w][0])
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary ${size === "lg" ? "size-12 text-lg sm:size-16 sm:text-2xl" : "size-12 text-lg"}`}
    >
      {initials || "•"}
    </span>
  );
}
