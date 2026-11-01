"use client";

import { CalendarDays, ClipboardList, DoorOpen, FileText, HeartPulse, History, LayoutDashboard, ListChecks, MessageSquareText, MessagesSquare, Pill, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Icons are looked up here because components can't be passed from the server layout.
const icons = {
  overview: LayoutDashboard,
  medicines: Pill,
  health: HeartPulse,
  documents: FileText,
  appointments: CalendarDays,
  tasks: ListChecks,
  visits: DoorOpen,
  updates: MessageSquareText,
  messages: MessagesSquare,
  timeline: History,
  members: Users,
  settings: Settings,
  activity: ClipboardList,
};

export type CircleTab = { href: string; label: string; icon: keyof typeof icons };

/** One row of tabs that scrolls sideways on small screens instead of wrapping into a wall of links. */
export function CircleNav({ tabs, label }: { tabs: CircleTab[]; label: string }) {
  const pathname = usePathname();
  const current = useRef<HTMLAnchorElement>(null);
  // Keep the current tab in view when the row is scrolled. The braces matter: newer browsers
  // return a Promise from scrollIntoView, and an effect must return nothing or a cleanup function.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <nav aria-label={label} className="-mx-4 sm:mx-0">
      <ul className="scrollbar-none flex gap-1 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:px-0">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          const Icon = icons[tab.icon];
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                ref={active ? current : undefined}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-12 items-center gap-2 rounded-full px-4 font-semibold transition ${
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted hover:bg-surface hover:text-foreground"
                }`}
              >
                <Icon aria-hidden="true" className="size-5" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
