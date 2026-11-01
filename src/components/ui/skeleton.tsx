/**
 * Grey placeholder shapes shown while a page's data loads, so a tap shows something straight away.
 * Decorative: the surrounding region carries aria-busy for assistive technology.
 */
export function Bar({ className = "h-4 w-40" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-full bg-sunken ${className}`} />;
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="card flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="size-10 animate-pulse rounded-xl bg-sunken" />
        <Bar className="h-5 w-44" />
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <Bar key={i} className={`h-4 ${i % 2 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

/** A page's worth of placeholder cards. */
export function PageSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Bar className="h-7 w-56" />
      <CardSkeleton lines={4} />
      <div className="grid gap-6 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
