import Link from "next/link";
import { getRequestTranslator } from "@/i18n/server";
import { formatDate } from "@/lib/format";
import { clockTime, dayLabel } from "@/lib/simple-view";
import { attentionEntry, doseTally } from "@/lib/today-view";
import { orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { getCircleToday } from "@/server/services/today";

const card = "flex flex-col gap-3 rounded-xl border border-border bg-surface p-6";
const seeAll = "self-start inline-flex min-h-12 items-center font-semibold underline";

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">{t("today.title", { name })}</h2>
        <p className="mt-1 text-lg">
          {last
            ? t("today.lastRecorded", { what: t(`today.what_${last.kind}`), by: last.by ?? t("today.someone"), time: when(last.at) })
            : t("today.nothingRecorded")}
        </p>
        <p className="mt-1 text-muted">{t("today.notAVerdict", { name })}</p>
      </div>

      <section aria-labelledby="attention-heading" className={card}>
        <h3 id="attention-heading" className="text-xl font-semibold">
          {t("today.attentionTitle")}
        </h3>
        {today.attention.length === 0 ? (
          <p className="text-lg">✓ {t("today.attentionNone")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {today.attention.map((item, i) => {
              const e = attentionEntry(item, circleId, when);
              return (
                <li key={i}>
                  <Link
                    href={e.href}
                    className={
                      e.urgent
                        ? "flex min-h-14 items-center rounded-lg bg-danger px-4 text-lg font-bold text-primary-foreground"
                        : "flex min-h-12 items-center rounded-lg border-2 border-warning px-4 text-lg font-medium hover:bg-background"
                    }
                  >
                    {t(`today.${e.key}`, e.vars)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {today.medicines && (
          <section aria-labelledby="meds-heading" className={card}>
            <h3 id="meds-heading" className="text-xl font-semibold">
              💊 {t("today.medsTitle")}
            </h3>
            {doseTally(today.medicines.counts).length === 0 ? (
              <p>{t("today.medsNone")}</p>
            ) : (
              <dl className="flex flex-wrap gap-x-6 gap-y-2 text-lg">
                {doseTally(today.medicines.counts).map((x) => (
                  <div key={x.key} className="flex gap-2">
                    <dt>{t(`today.${x.key}`)}:</dt>
                    <dd className="font-bold">{x.count}</dd>
                  </div>
                ))}
              </dl>
            )}
            {today.medicines.next.length > 0 && (
              <>
                <h4 className="font-semibold">{t("today.nextDoses")}</h4>
                <ul className="flex flex-col gap-1">
                  {today.medicines.next.map((d) => (
                    <li key={d.id}>
                      {d.scheduledFor && <span className="font-semibold">{clockTime(d.scheduledFor, locale, tz)} · </span>}
                      {d.medication.name} ({d.medication.dosage})
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Link href={`${base}/medicines`} className={seeAll}>
              {t("today.seeAll")}
            </Link>
          </section>
        )}

        {today.appointments && (
          <section aria-labelledby="appts-heading" className={card}>
            <h3 id="appts-heading" className="text-xl font-semibold">
              📅 {t("today.apptsTitle")}
            </h3>
            {today.appointments.upcoming.length === 0 ? (
              <p>{t("today.apptsNone")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {today.appointments.upcoming.map((a) => (
                  <li key={a.id}>
                    <p className="font-semibold">
                      {when(a.startsAt)} · {a.title}
                    </p>
                    {a.transportNeeded && (
                      <p className={a.transport ? "text-muted" : "font-semibold text-warning"}>
                        {a.transport ? t("today.apptDriver", { name: a.transport.name ?? "" }) : t("today.apptNoDriver")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link href={`${base}/appointments`} className={seeAll}>
              {t("today.seeAll")}
            </Link>
          </section>
        )}

        {today.tasks && (
          <section aria-labelledby="tasks-heading" className={card}>
            <h3 id="tasks-heading" className="text-xl font-semibold">
              ✅ {t("today.tasksTitle")}
            </h3>
            {today.tasks.mine.length === 0 ? (
              <p>{t("today.tasksNone")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {today.tasks.mine.map((task) => (
                  <li key={task.id}>
                    <span className="font-semibold">{task.title}</span>
                    {task.dueAt && <span className={task.dueAt < now ? "text-danger" : "text-muted"}> · {t("today.dueBy", { time: when(task.dueAt) })}</span>}
                  </li>
                ))}
              </ul>
            )}
            {today.tasks.unassignedCount > 0 && <p>{t("today.tasksUnassigned", { count: today.tasks.unassignedCount })}</p>}
            <Link href={`${base}/tasks`} className={seeAll}>
              {t("today.seeAll")}
            </Link>
          </section>
        )}

        {today.visits && (
          <section aria-labelledby="visits-heading" className={card}>
            <h3 id="visits-heading" className="text-xl font-semibold">
              🏠 {t("today.visitsTitle")}
            </h3>
            {today.visits.today.length === 0 ? (
              <p>{t("today.visitsNone")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {today.visits.today.map((v) => {
                  const visitor = v.visitor?.name ?? t("today.someone");
                  return (
                    <li key={v.id} className={v.status === "in_progress" ? "font-semibold" : undefined}>
                      {v.status === "in_progress" ? t("today.visitHere", { name: visitor }) : t("today.visitPlanned", { name: visitor, time: when(v.plannedStart) })}
                    </li>
                  );
                })}
              </ul>
            )}
            {today.visits.latestHandover?.handoverNote && (
              <figure className="rounded-lg bg-background p-3">
                <figcaption className="font-semibold">{t("today.handover", { name: today.visits.latestHandover.visitor?.name ?? t("today.someone") })}</figcaption>
                <blockquote className="mt-1 whitespace-pre-line">{today.visits.latestHandover.handoverNote}</blockquote>
              </figure>
            )}
            <Link href={`${base}/visits`} className={seeAll}>
              {t("today.seeAll")}
            </Link>
          </section>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="emergency-heading" className="rounded-xl border-2 border-danger bg-surface p-6">
          <h3 id="emergency-heading" className="text-xl font-semibold">
            {t("circle.emergencyNumber")}
          </h3>
          <a
            href={`tel:${p.emergencyNumber}`}
            className="mt-3 inline-flex min-h-14 items-center rounded-lg bg-danger px-6 text-xl font-bold text-primary-foreground"
          >
            {t("circle.callEmergency", { number: p.emergencyNumber })}
          </a>
          <p className="mt-3 text-muted">{t("safety.notEmergencyService")}</p>
        </section>

        <section aria-labelledby="about-heading" className="rounded-xl border border-border bg-surface p-6">
          <h3 id="about-heading" className="text-xl font-semibold">
            {t("circle.about", { name })}
          </h3>
          <p className="mt-3 text-lg font-medium">{p.displayName}</p>
          {p.dateOfBirth && (
            <dl className="mt-1 flex gap-2">
              <dt className="text-muted">{t("circle.dateOfBirth")}:</dt>
              <dd>{formatDate(`${p.dateOfBirth}T12:00:00Z`, locale, "UTC")}</dd>
            </dl>
          )}
          <ul className="mt-2 flex flex-col gap-1">
            <li>{p.selfManaging ? t("circle.managesOwnCare") : t("circle.decisionsByFamily")}</li>
            <li>{p.hasOwnAccount ? t("circle.hasAccount") : t("circle.noAccount")}</li>
          </ul>
          <p className="mt-4 font-semibold">{t("home.yourRole", { role: t(`roles.${role}`) })}</p>
          <p className="text-muted">{t(`roleHints.${role}`)}</p>
        </section>
      </div>
    </div>
  );
}
