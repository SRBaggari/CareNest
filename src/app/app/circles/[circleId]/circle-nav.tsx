"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function CircleNav({ tabs, label }: { tabs: { href: string; label: string }[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="border-b border-border">
      <ul className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const current = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-12 items-center border-b-4 px-4 font-semibold ${
                  current ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
