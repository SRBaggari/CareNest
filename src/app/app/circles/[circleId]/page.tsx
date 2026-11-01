import {
  CalendarDays,
  Car,
  ChevronRight,
  CircleCheck,
  Clock,
  DoorOpen,
  LifeBuoy,
  ListChecks,
  type LucideIcon,
  PackageOpen,
  Phone,
  Pill,
  TriangleAlert,
  UserRound,
  UserRoundX,
} from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, IconTile, SectionCard } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { formatDate } from "@/lib/format";
import { clockTime, dayLabel } from "@/lib/simple-view";
import { attentionEntry, doseTally } from "@/lib/today-view";
import { orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { getCircleToday } from "@/server/services/today";

const attentionIcon: Record<string, LucideIcon> = {
  attnHelp: LifeBuoy,
  attnDoses: Pill,
  attnDriver: Car,
  attnVisit: UserRoundX,
  attnStock: PackageOpen,
  attnOverdue: Clock,
  attnUnassigned: ListChecks,
};

const tallyStyle: Record<string, string> = {
  dose_unconfirmed: "bg-warning-soft text-warning",
  dose_due: "bg-primary-soft text-primary",
  dose_taken: "bg-success-soft text-success",
  dose_skipped: "bg-sunken text-muted",
  dose_upcoming: "bg-sunken text-foreground",
};

/** The family and caregiver dashboard: what needs someone first, then today's plan. */
export default async function CircleToday({ params }: PageProps<"/app/circles/[circleId]">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}`);
  const [circle, today] = await Promise.all([orNotFound(getCircle(ctx, circleId)), getCircleToday(ctx, circleId)]);
  const { locale, t } = await getRequestTranslator();
  const p = circle.profile;
  const name = p.preferredName ?? p.displayName;
  const role = circle.myMembership.role;
  const tz = p.timeZone;
  const now = ctx.now;
  // Times today read as "10:30"; anything else also names the day.
  const when = (d: Date | string) => {
    const time = clockTime(d, locale, tz);
    if (formatDate(d, locale, tz) === formatDate(now, locale, tz)) return time;
    return `${dayLabel(d, now, tz) === "tomorrow" ? t("simple.day_tomorrow") : formatDate(d, locale, tz)} ${time}`;
  };
  const base = `/app/circles/${circleId}`;
  const last = today.lastRecordedActivity;
  const seeAll = (path: string) => ({ href: `${base}/${path}`, label: t("today.seeAll") });
  const tally = today.medicines ? doseTally(today.medicines.counts) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold">{t("today.title", { name })}</h2>
        <p className="inline-flex items-center gap-2 text-lg">
          <Clock aria-hidden="true" className="size-5 shrink-0 text-muted" />
          {last
            ? t("today.lastRecorded", { what: t(`today.what_${last.kind}`), by: last.by ?? t("today.someone"), time: when(last.at) })
            : t("today.nothingRecorded")}
        </p>
        <p className="text-muted">{t("today.notAVerdict", { name })}</p>
      </div>

      {today.attention.length === 0 ? (
        <section aria-labelledby="attention-heading" className="flex items-center gap-4 rounded-[1.25rem] bg-success-soft p-5 text-success">
          <CircleCheck aria-hidden="true" className="size-8 shrink-0" />
          <div>
            <h3 id="attention-heading" className="text-xl font-bold">
              {t("today.attentionTitle")}
            </h3>
            <p className="text-lg text-foreground">{t("today.attentionNone")}</p>
          </div>
        </section>
      ) : (
        <SectionCard id="attention-heading" icon={TriangleAlert} tone="warning" title={t("today.attentionTitle")}>
          <ul className="flex flex-col gap-2">
            {today.attention.map((item, i) => {
              const e = attentionEntry(item, circleId, when);
              const Icon = attentionIcon[e.key] ?? TriangleAlert;
              return (
                <li key={i}>
                  <Link
                    href={e.href}
                    className={`flex min-h-14 items-center gap-3 rounded-xl px-4 py-2 text-lg transition ${
                      e.urgent ? "bg-danger font-bold text-primary-foreground hover:brightness-110" : "bg-warning-soft font-semibold hover:brightness-95"
                    }`}
                  >
                    <Icon aria-hidden="true" className={`size-6 shrink-0 ${e.urgent ? "" : "text-warning"}`} />
                    <span className="flex-1">{t(`today.${e.key}`, e.vars)}</span>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {today.medicines && (
          <SectionCard id="meds-heading" icon={Pill} title={t("today.medsTitle")} action={seeAll("medicines")}>
            {tally.length === 0 ? (
              <p className="text-muted">{t("today.medsNone")}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {tally.map((x) => (
                  <div key={x.key} className={`flex min-w-0 flex-col-reverse rounded-xl px-4 py-3 break-words ${tallyStyle[x.key]}`}>
                    <dt className="font-semibold">{t(`today.${x.key}`)}</dt>
                    <dd className="text-3xl font-bold leading-none">{x.count}</dd>
                  </div>
                ))}
              </dl>
            )}
            {today.medicines.next.length > 0 && (
              <div>
                <h4 className="font-bold text-muted">{t("today.nextDoses")}</h4>
                <ul className="mt-2 flex flex-col divide-y divide-border">
                  {today.medicines.next.map((d) => (
                    <li key={d.id} className="flex items-baseline gap-3 py-2">
                      {d.scheduledFor && <span className="w-20 shrink-0 font-bold text-primary">{clockTime(d.scheduledFor, locale, tz)}</span>}
                      <span>
                        <span className="font-semibold">{d.medication.name}</span> <span className="text-muted">· {d.medication.dosage}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>
        )}

        {today.appointments && (
          <SectionCard id="appts-heading" icon={CalendarDays} title={t("today.apptsTitle")} action={seeAll("appointments")}>
            {today.appointments.upcoming.length === 0 ? (
              <p className="text-muted">{t("today.apptsNone")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {today.appointments.upcoming.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1 py-2 first:pt-0">
                    <p className="font-bold">{a.title}</p>
                    <p className="text-muted">{when(a.startsAt)}</p>
                    {a.transportNeeded && (
                      <div>
                        {a.transport ? (
                          <Badge tone="success">
                            <Car aria-hidden="true" className="size-4" />
                            {t("today.apptDriver", { name: a.transport.name ?? "" })}
                          </Badge>
                        ) : (
                          <Badge tone="warning">
                            <Car aria-hidden="true" className="size-4" />
                            {t("today.apptNoDriver")}
                          </Badge>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {today.tasks && (
          <SectionCard id="tasks-heading" icon={ListChecks} title={t("today.tasksTitle")} action={seeAll("tasks")}>
            {today.tasks.mine.length === 0 ? (
              <p className="text-muted">{t("today.tasksNone")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {today.tasks.mine.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 first:pt-0">
                    <span className="font-semibold">{task.title}</span>
                    {task.dueAt && (
                      <span className={task.dueAt < now ? "font-semibold text-danger" : "text-muted"}>{t("today.dueBy", { time: when(task.dueAt) })}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {today.tasks.unassignedCount > 0 && (
              <p className="rounded-xl bg-warning-soft px-4 py-2 font-semibold text-warning">{t("today.tasksUnassigned", { count: today.tasks.unassignedCount })}</p>
            )}
          </SectionCard>
        )}

        {today.visits && (
          <SectionCard id="visits-heading" icon={DoorOpen} title={t("today.visitsTitle")} action={seeAll("visits")}>
            {today.visits.today.length === 0 ? (
              <p className="text-muted">{t("today.visitsNone")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {today.visits.today.map((v) => {
                  const visitor = v.visitor?.name ?? t("today.someone");
                  return (
                    <li key={v.id} className="flex items-center gap-2">
                      <UserRound aria-hidden="true" className="size-5 text-muted" />
                      {v.status === "in_progress" ? (
                        <Badge tone="success">{t("today.visitHere", { name: visitor })}</Badge>
                      ) : (
                        t("today.visitPlanned", { name: visitor, time: when(v.plannedStart) })
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {today.visits.latestHandover?.handoverNote && (
              <figure className="rounded-xl border-l-4 border-primary bg-sunken p-4">
                <figcaption className="font-bold">{t("today.handover", { name: today.visits.latestHandover.visitor?.name ?? t("today.someone") })}</figcaption>
                <blockquote className="mt-1 whitespace-pre-line">{today.visits.latestHandover.handoverNote}</blockquote>
              </figure>
            )}
          </SectionCard>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="emergency-heading" className="card flex flex-col gap-4 border-2 border-danger">
          <div className="flex items-center gap-3">
            <IconTile icon={Phone} tone="danger" />
            <h3 id="emergency-heading" className="text-xl font-bold">
              {t("circle.emergencyNumber")}
            </h3>
          </div>
          <a href={`tel:${p.emergencyNumber}`} className={`${buttonClass("dangerSolid", "lg")} self-start`}>
            <Phone aria-hidden="true" className="size-6" />
            {t("circle.callEmergency", { number: p.emergencyNumber })}
          </a>
          <p className="text-muted">{t("safety.notEmergencyService")}</p>
        </section>

        <SectionCard id="about-heading" icon={UserRound} title={t("circle.about", { name })}>
          <div>
            <p className="text-lg font-bold">{p.displayName}</p>
            {p.dateOfBirth && (
              <dl className="flex gap-2">
                <dt className="text-muted">{t("circle.dateOfBirth")}:</dt>
                <dd>{formatDate(`${p.dateOfBirth}T12:00:00Z`, locale, "UTC")}</dd>
              </dl>
            )}
          </div>
          <ul className="flex flex-wrap gap-2">
            <li>
              <Badge tone="primary">{p.selfManaging ? t("circle.managesOwnCare") : t("circle.decisionsByFamily")}</Badge>
            </li>
            <li>
              <Badge>{p.hasOwnAccount ? t("circle.hasAccount") : t("circle.noAccount")}</Badge>
            </li>
          </ul>
          <div className="rounded-xl bg-sunken p-4">
            <p className="font-bold">{t("home.yourRole", { role: t(`roles.${role}`) })}</p>
            <p className="text-muted">{t(`roleHints.${role}`)}</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
