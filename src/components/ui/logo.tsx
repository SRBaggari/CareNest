/** The CareNest mark: a roof sheltering a heart. Decorative — the name is always shown or labelled beside it. */
export function LogoMark({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <rect width="40" height="40" rx="12" fill="var(--primary)" />
      <path d="M8.5 16.5 20 7l11.5 9.5" fill="none" stroke="var(--primary-foreground)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M20 32.5s-7.5-4.6-7.5-9.8c0-2.4 1.7-4.2 3.9-4.2 1.5 0 2.8.9 3.6 2.1.8-1.2 2.1-2.1 3.6-2.1 2.2 0 3.9 1.8 3.9 4.2 0 5.2-7.5 9.8-7.5 9.8Z"
        fill="var(--primary-foreground)"
      />
    </svg>
  );
}

export function Logo({ name, compact = false }: { name: string; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark className={compact ? "size-9" : "size-10"} />
      <span className={`${compact ? "sr-only sm:not-sr-only" : ""} text-xl font-bold tracking-tight text-foreground`}>{name}</span>
    </span>
  );
}
