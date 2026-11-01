import { ChevronLeft, Clock, LifeBuoy, Smartphone } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { Avatar, Badge } from "@/components/ui/section";
import { Bar, PageSkeleton } from "@/components/ui/skeleton";
import { getRequestTranslator } from "@/i18n/server";
import { formatLocalTime } from "@/lib/format";
import { orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { unreadThreadCount } from "@/server/services/messages";
import { CircleNav, type NavGroup, type NavItem } from "./circle-nav";

/**
 * The frame renders at once; the header, the navigation and the page each stream in behind their
 * own placeholder, so tapping a circle or a section shows something immediately.
 */
export default function CircleLayout({ children, params }: LayoutProps<"/app/circles/[circleId]">) {
  return (
    // Room at the bottom on phones for the fixed section bar.
    <div className="flex flex-col gap-5 pb-24 lg:pb-0 print:pb-0">
      <Suspense fallback={<HeaderSkeleton />}>
        <CircleHeader params={params} />
      </Suspense>
      <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8 print:block">
        <div className="print:hidden">
          <Suspense fallback={<div className="hidden lg:block" />}>
            <CircleNavigation params={params} />
          </Suspense>
        </div>
        <Suspense fallback={<PageSkeleton />}>
          <InLanguage>{children}</InLanguage>
        </Suspense>
      </div>
    </div>
  );
}

/** Marks the page content with the reader's language, for screen readers and correct fonts. */
async function InLanguage({ children }: { children: ReactNode }) {
  const { locale } = await getRequestTranslator();
  return (
    <div lang={locale} className="min-w-0">
      {children}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div aria-busy="true" className="flex items-center gap-3">
      <span aria-hidden="true" className="size-12 animate-pulse rounded-full bg-sunken" />
      <div className="flex flex-col gap-2">
        <Bar className="h-6 w-48" />
        <Bar className="h-4 w-60" />
      </div>
    </div>
  );
}

async function CircleHeader({ params }: { params: LayoutProps<"/app/circles/[circleId]">["params"] }) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;
  const base = `/app/circles/${circleId}`;

  return (
    <div lang={locale} className="flex flex-col gap-2 print:hidden">
      <Link href="/app" className="-ml-1 inline-flex min-h-11 items-center gap-1 self-start text-base font-semibold text-primary hover:underline">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("circle.switch")}
      </Link>
      <div className="flex items-center gap-3 sm:gap-4">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold sm:text-3xl">{circle.name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-base text-muted">
            <span className="font-semibold text-foreground">{name}</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock aria-hidden="true" className="size-4 shrink-0" />
              {formatLocalTime(ctx.now, locale, circle.profile.timeZone)}
            </span>
          </p>
        </div>
        {/* Always one tap away on every circle page, without taking over the screen. */}
        {circle.myCapabilities.includes("emergency.view") && (
          <Link href={`${base}/emergency`} className={`${buttonClass("dangerSolid")} shrink-0 shadow-md shadow-danger/20`}>
            <LifeBuoy aria-hidden="true" className="size-5" />
            {t("circle.help")}
          </Link>
        )}
      </div>
      {/* The person receiving care can go back to their Simple view at any time. */}
      {circle.myMembership.role === "care_recipient" && (
        <Link href={`/view?mode=simple&next=${encodeURIComponent(`/simple/${circleId}`)}`} className={`${buttonClass("secondary")} self-start`}>
          <Smartphone aria-hidden="true" className="size-5" />
          {t("simple.simpleView")}
        </Link>
      )}
      {circle.status === "archived" && (
        <div>
          <Badge tone="warning">{t("circle.isArchived")}</Badge>
        </div>
      )}
    </div>
  );
}

async function CircleNavigation({ params }: { params: LayoutProps<"/app/circles/[circleId]">["params"] }) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { t } = await getRequestTranslator();
  const can = (c: string) => circle.myCapabilities.includes(c as (typeof circle.myCapabilities)[number]);
  const base = `/app/circles/${circleId}`;
  const unread = can("update.view") ? await unreadThreadCount(ctx, circleId) : 0;
  const item = (path: string, key: string, icon: NavItem["icon"], show = true, badge?: number): NavItem[] =>
    show ? [{ href: path ? `${base}/${path}` : base, label: t(`circle.${key}`), icon, badge }] : [];

  const groups: NavGroup[] = (
    [
      { id: "today", label: t("nav.today"), items: [{ href: base, label: t("nav.today"), icon: "overview" }] },
      {
        id: "care",
        label: t("nav.care"),
        items: [...item("medicines", "medicines", "medicines", can("medication.view")), ...item("health", "health", "health", can("health.view")), ...item("documents", "documents", "documents", can("health.view")), ...item("reports", "reports", "reports", can("medication.view") || can("health.view"))],
      },
      {
        id: "plans",
        label: t("nav.plans"),
        items: [...item("appointments", "appointments", "appointments", can("appointment.view")), ...item("tasks", "tasks", "tasks", can("task.view")), ...item("visits", "visits", "visits", can("update.view"))],
      },
      {
        id: "family",
        label: t("nav.family"),
        items: [...item("updates", "updates", "updates", can("update.view")), ...item("messages", "messages", "messages", can("update.view"), unread), ...item("timeline", "timeline", "timeline", can("update.view"))],
      },
      {
        id: "circle",
        label: t("nav.circle"),
        items: [...item("members", "members", "members", can("members.view")), ...item("settings", "settings", "settings"), ...item("activity", "activity", "activity", can("audit.view"))],
      },
    ] satisfies NavGroup[]
  ).filter((g) => g.items.length > 0);

  return <CircleNav groups={groups} label={t("nav.sections")} newMessagesLabel={t("nav.newMessages")} />;
}
