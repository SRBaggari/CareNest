"use client";

import {
  CalendarDays,
  ClipboardList,
  DoorOpen,
  FileText,
  HeartPulse,
  History,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  MessagesSquare,
  Pill,
  Settings,
  Sun,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
const groupIcons: Record<GroupId, LucideIcon> = { today: Sun, care: Pill, plans: CalendarDays, family: UsersRound, circle: Settings };

export type GroupId = "today" | "care" | "plans" | "family" | "circle";
export type NavItem = { href: string; label: string; icon: keyof typeof icons; badge?: number };
export type NavGroup = { id: GroupId; label: string; items: NavItem[] };

/** The overview matches only itself; every other item also owns its sub-pages (a conversation, say). */
function isActive(pathname: string, item: NavItem, exact: boolean) {
  return exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Thirteen places, grouped into five: Today · Care · Plans · Family · Circle.
 * Wide screens: a sidebar showing every group. Phones: the group's own tabs above the page and a
 * bar of the five groups at the bottom, within thumb's reach.
 */
export function CircleNav({ groups, label, newMessagesLabel }: { groups: NavGroup[]; label: string; newMessagesLabel: string }) {
  const pathname = usePathname();
  const overview = groups[0]?.items[0];
  const activeItem = groups.flatMap((g) => g.items).find((item) => isActive(pathname, item, item === overview));
  const activeGroup = groups.find((g) => g.items.includes(activeItem!)) ?? groups[0];
  const badgeOf = (g: NavGroup) => g.items.reduce((n, i) => n + (i.badge ?? 0), 0);

  return (
    <>
      {/* Wide screens: the whole map, always visible. */}
      <nav aria-label={label} className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.id}>
              {group.items.length > 1 && <p className="mb-1 px-3 text-sm font-bold tracking-wide text-muted uppercase">{group.label}</p>}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = icons[item.icon];
                  const active = item === activeItem;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`relative flex min-h-11 items-center gap-3 rounded-xl px-3 font-semibold transition ${
                          active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface hover:text-foreground"
                        }`}
                      >
                        {active && <span aria-hidden="true" className="absolute top-2 bottom-2 left-0 w-1 rounded-full bg-primary" />}
                        <Icon aria-hidden="true" className="size-5 shrink-0" />
                        <span className="flex-1">{item.label}</span>
                        {item.badge ? (
                          <span className="rounded-full bg-primary px-2 text-sm font-bold text-primary-foreground" aria-label={newMessagesLabel.replace("{count}", String(item.badge))}>
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Phones and tablets: this group's places, as tabs above the page. */}
      {activeGroup.items.length > 1 && (
        <nav aria-label={activeGroup.label} className="-mx-4 mb-4 lg:hidden">
          <ul className="scrollbar-none flex gap-1 overflow-x-auto px-4">
            {activeGroup.items.map((item) => {
              const active = item === activeItem;
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-semibold transition ${
                      active ? "bg-primary text-primary-foreground shadow-sm" : "bg-surface text-muted ring-1 ring-border hover:text-foreground"
                    }`}
                  >
                    {item.label}
                    {item.badge ? <span className="rounded-full bg-primary-soft px-1.5 text-sm text-primary">{item.badge}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* Phones and tablets: the five groups, fixed at the bottom. */}
      <nav aria-label={label} className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}>
          {groups.map((group) => {
            const Icon = groupIcons[group.id];
            const active = group === activeGroup;
            const badge = badgeOf(group);
            return (
              <li key={group.id}>
                <Link
                  href={group.items[0].href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-center text-sm leading-tight font-semibold break-words ${
                    active ? "text-primary" : "text-muted"
                  }`}
                >
                  <span className={`inline-flex h-8 w-14 items-center justify-center rounded-full transition ${active ? "bg-primary-soft" : ""}`}>
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  {group.label}
                  {badge > 0 && (
                    <span aria-label={newMessagesLabel.replace("{count}", String(badge))} className="absolute top-1.5 left-1/2 ml-3 min-w-5 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                      {badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
