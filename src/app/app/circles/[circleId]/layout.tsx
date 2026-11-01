import { ChevronLeft, Clock, LifeBuoy, Smartphone } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Avatar, Badge } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { formatLocalTime } from "@/lib/format";
import { orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { CircleNav, type CircleTab } from "./circle-nav";

export default async function CircleLayout({ children, params }: LayoutProps<"/app/circles/[circleId]">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;
  const can = (c: string) => circle.myCapabilities.includes(c as (typeof circle.myCapabilities)[number]);
  const base = `/app/circles/${circleId}`;

  const tabs: CircleTab[] = [
    { href: base, label: t("circle.overview"), icon: "overview" },
    ...(can("medication.view") ? [{ href: `${base}/medicines`, label: t("circle.medicines"), icon: "medicines" } as const] : []),
    ...(can("appointment.view") ? [{ href: `${base}/appointments`, label: t("circle.appointments"), icon: "appointments" } as const] : []),
    ...(can("task.view") ? [{ href: `${base}/tasks`, label: t("circle.tasks"), icon: "tasks" } as const] : []),
    ...(can("update.view")
      ? ([
          { href: `${base}/visits`, label: t("circle.visits"), icon: "visits" },
          { href: `${base}/updates`, label: t("circle.updates"), icon: "updates" },
          { href: `${base}/timeline`, label: t("circle.timeline"), icon: "timeline" },
        ] as const)
      : []),
    ...(can("members.view") ? [{ href: `${base}/members`, label: t("circle.members"), icon: "members" } as const] : []),
    { href: `${base}/settings`, label: t("circle.settings"), icon: "settings" },
    ...(can("audit.view") ? [{ href: `${base}/activity`, label: t("circle.activity"), icon: "activity" } as const] : []),
  ];

  return (
    <div lang={locale} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Link href="/app" className="inline-flex min-h-12 items-center gap-1 self-start font-semibold text-primary hover:underline">
          <ChevronLeft aria-hidden="true" className="size-5" />
          {t("circle.switch")}
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold sm:text-3xl">{circle.name}</h1>
            <p className="mt-1 flex flex-col text-muted sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
              <span className="font-semibold text-foreground">{name}</span>
              <span aria-hidden="true" className="max-sm:hidden">
                ·
              </span>
              <span className="inline-flex items-center gap-2">
                <Clock aria-hidden="true" className="size-4 shrink-0" />
                {t("home.localTime", { time: formatLocalTime(ctx.now, locale, circle.profile.timeZone) })}
              </span>
            </p>
          </div>
          {/* Always one tap away on every circle page. */}
          {can("emergency.view") && (
            <Link href={`${base}/emergency`} className={`${buttonClass("dangerSolid", "lg")} max-sm:w-full`}>
              <LifeBuoy aria-hidden="true" className="size-6" />
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
      <CircleNav tabs={tabs} label={circle.name} />
      <div>{children}</div>
    </div>
  );
}
