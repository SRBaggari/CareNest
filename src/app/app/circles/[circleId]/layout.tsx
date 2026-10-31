import Link from "next/link";
import { getRequestTranslator } from "@/i18n/server";
import { formatLocalTime } from "@/lib/format";
import { orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { CircleNav } from "./circle-nav";

export default async function CircleLayout({ children, params }: LayoutProps<"/app/circles/[circleId]">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;

  const tabs = [
    { href: `/app/circles/${circleId}`, label: t("circle.overview") },
    ...(circle.myCapabilities.includes("medication.view")
      ? [{ href: `/app/circles/${circleId}/medicines`, label: t("circle.medicines") }]
      : []),
    ...(circle.myCapabilities.includes("appointment.view")
      ? [{ href: `/app/circles/${circleId}/appointments`, label: t("circle.appointments") }]
      : []),
    ...(circle.myCapabilities.includes("task.view") ? [{ href: `/app/circles/${circleId}/tasks`, label: t("circle.tasks") }] : []),
    ...(circle.myCapabilities.includes("update.view")
      ? [
          { href: `/app/circles/${circleId}/visits`, label: t("circle.visits") },
          { href: `/app/circles/${circleId}/updates`, label: t("circle.updates") },
          { href: `/app/circles/${circleId}/timeline`, label: t("circle.timeline") },
        ]
      : []),
    ...(circle.myCapabilities.includes("members.view") ? [{ href: `/app/circles/${circleId}/members`, label: t("circle.members") }] : []),
    { href: `/app/circles/${circleId}/settings`, label: t("circle.settings") },
    ...(circle.myCapabilities.includes("audit.view") ? [{ href: `/app/circles/${circleId}/activity`, label: t("circle.activity") }] : []),
  ];

  return (
    <div lang={locale} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/app" className="self-start py-2 font-medium text-primary underline">
          ← {t("circle.switch")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">{circle.name}</h1>
          {/* Always one tap away on every circle page. */}
          {circle.myCapabilities.includes("emergency.view") && (
            <Link
              href={`/app/circles/${circleId}/emergency`}
              className="inline-flex min-h-14 items-center rounded-xl bg-danger px-6 text-xl font-bold text-primary-foreground"
            >
              {t("circle.help")}
            </Link>
          )}
        </div>
        <p className="text-lg text-muted">
          {name} · {t("home.localTime", { time: formatLocalTime(ctx.now, locale, circle.profile.timeZone) })}
        </p>
        {circle.status === "archived" && <p className="font-semibold text-warning">{t("circle.isArchived")}</p>}
      </div>
      <CircleNav tabs={tabs} label={circle.name} />
      <div>{children}</div>
    </div>
  );
}
