import type { ReactNode } from "react";

/** The top of every section page: its name, one line on what it's for, and its main action. */
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-72">
        <h2 className="text-2xl font-bold sm:text-3xl">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-muted">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
