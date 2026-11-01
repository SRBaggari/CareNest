import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpButton } from "@/app/app/circles/[circleId]/emergency/help-button";
import { getRequestTranslator } from "@/i18n/server";
import { clockTime, dayLabel, greetingFor, groupDoses } from "@/lib/simple-view";
import { orNotFound, pageContext } from "@/server/page";
import { listAppointments } from "@/server/services/appointments";
import { listAssistance } from "@/server/services/assistance";
import { getCircle } from "@/server/services/circles";
import { listDoses } from "@/server/services/doses";
import { listEmergencyContacts } from "@/server/services/emergency";
import { listVisits } from "@/server/services/visits";
import { CheckIn, DoseQuestion } from "./simple-actions";

export const metadata: Metadata = { title: "My day" };

const card = "flex flex-col gap-4 rounded-2xl border-2 border-border bg-surface p-5";
const heading = "text-3xl font-bold";

export default async function SimpleView({ params }: PageProps<"/simple/[circleId]">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/simple/${circleId}`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  // This screen is written for the person receiving care ("your medicines").
  if (circle.myMembership.role !== "care_recipient") redirect(`/app/circles/${circleId}`);

  const { locale, t } = await getRequestTranslator();
  const tz = circle.profile.timeZone;
  const now = ctx.now;
  const name = circle.profile.preferredName ?? circle.profile.displayName;
  const number = circle.profile.emergencyNumber;
  const caps = new Set(circle.myCapabilities);
  const active = circle.status === "active";
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric") };
  const time = (d: Date | string) => clockTime(d, locale, tz);

  const [day, appointments, visits, contacts, requests] = await Promise.all([
    caps.has("medication.view") ? listDoses(ctx, circleId, { days: 1 }) : null,
    caps.has("appointment.view") ? listAppointments(ctx, circleId, { range: "upcoming", limit: 10 }) : [],
    caps.has("update.view") ? listVisits(ctx, circleId, "upcoming") : [],
    listEmergencyContacts(ctx, circleId),
    listAssistance(ctx, circleId),
  ]);
  const doses = day ? groupDoses(day.doses, now) : null;
  const openHelp = requests.find((r) => !r.isPractice && (r.status === "open" || r.status === "acknowledged"));

  type Coming = { at: Date; text: string; extra?: string };
  const coming: Coming[] = [];
  for (const v of visits) {
    if (v.status === "in_progress") coming.push({ at: v.plannedStart, text: t("simple.visitHere", { name: v.visitor?.name ?? t("audit.someone") }) });
    else if (v.status === "planned" && dayLabel(v.plannedStart, now, tz) !== "later" && v.plannedStart > now) {
      coming.push({
        at: v.plannedStart,
        text: t("simple.visitToday", { name: v.visitor?.name ?? t("audit.someone"), day: t(`simple.day_${dayLabel(v.plannedStart, now, tz)}`), time: time(v.plannedStart) }),
      });
    }
  }
  for (const a of appointments) {
    if (a.status !== "scheduled" || a.startsAt < now || dayLabel(a.startsAt, now, tz) === "later") continue;
    coming.push({
      at: a.startsAt,
      text: t("simple.apptLine", { day: t(`simple.day_${dayLabel(a.startsAt, now, tz)}`), time: time(a.startsAt), title: a.title }),
      extra: a.transportNeeded ? (a.transport ? t("simple.apptDriver", { name: a.transport.name ?? "" }) : t("simple.apptNoDriver")) : undefined,
    });
  }
  coming.sort((x, y) => x.at.getTime() - y.at.getTime());

  const helpLabels = {
    needHelp: t("emergency.needHelp"),
    confirmTitle: t("emergency.confirmTitle"),
    confirmBody: t("emergency.confirmBody", { number }),
    message: t("emergency.message"),
    shareLocation: t("emergency.shareLocation"),
    locationFailed: t("emergency.locationFailed"),
    yesAlert: t("emergency.yesAlert"),
    cancel: t("emergency.cancel"),
    sending: t("emergency.sending"),
    ...messages,
  };
  const doseLabels = {
    ...messages,
    ...Object.fromEntries(["didYouTake", "tookIt", "didNotTake", "whyNot", "later", "skipped", "refused", "back", "savedTaken", "savedOther"].map((k) => [k, t(`simple.${k}`)])),
  } as Parameters<typeof DoseQuestion>[0]["labels"];
  const statusLabel = { taken: "statusTaken", administered: "statusGiven", skipped: "statusSkipped", refused: "statusRefused" } as const;

  return (
    <div lang={locale} className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl font-bold leading-tight">{t(`simple.greeting_${greetingFor(now, tz)}`, { name })}</h1>
        <p className="mt-1 text-2xl text-muted">
          {t("simple.todayIs", { date: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now) })}
        </p>
      </div>

      {/* Help comes first, always. */}
      <section aria-label={t("emergency.title")} className="flex flex-col gap-3">
        {openHelp ? (
          <Link
            href={`/app/circles/${circleId}/emergency/${openHelp.id}`}
            className="inline-flex min-h-20 items-center justify-center rounded-2xl border-4 border-warning bg-surface px-6 text-2xl font-bold"
          >
            {t("emergency.activeTitle")}
          </Link>
        ) : (
          active && caps.has("emergency.raise") && <HelpButton url={`/api/v1/circles/${circleId}/emergency/requests`} circleId={circleId} labels={helpLabels} />
        )}
        <a href={`tel:${number}`} className="inline-flex min-h-16 items-center justify-center rounded-2xl border-4 border-danger bg-surface px-6 text-2xl font-bold text-danger">
          📞 {t("emergency.call", { number })}
        </a>
      </section>

      {doses && (
        <section aria-labelledby="meds-heading" className={card}>
          <h2 id="meds-heading" className={heading}>
            💊 {t("simple.medsTitle")}
          </h2>
          {doses.now.length === 0 && <p className="text-xl">{t("simple.medsNone")}</p>}
          {doses.now.map((d) => (
            <article key={d.id} className="flex flex-col gap-3 rounded-xl border-2 border-primary p-4">
              <p className="text-2xl font-bold">
                {d.scheduledFor && <span className="mr-2">{time(d.scheduledFor)}</span>}
                {d.medication.name}
              </p>
              <p className="text-xl">{d.medication.dosage}</p>
              {d.medication.instructions && <p className="text-xl text-muted">{d.medication.instructions}</p>}
              {active && caps.has("dose.record") && <DoseQuestion url={`/api/v1/circles/${circleId}/doses/${d.id}/record`} locale={locale} labels={doseLabels} />}
            </article>
          ))}

          {doses.later.length > 0 && (
            <div>
              <h3 className="text-2xl font-semibold">{t("simple.laterToday")}</h3>
              <ul className="mt-2 flex flex-col gap-2 text-xl">
                {doses.later.map((d) => (
                  <li key={d.id}>
                    <span className="font-semibold">{d.scheduledFor && t("simple.atTime", { time: time(d.scheduledFor) })}</span> · {d.medication.name} ({d.medication.dosage})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {doses.done.length > 0 && (
            <div>
              <h3 className="text-2xl font-semibold">{t("simple.doneToday")}</h3>
              <ul className="mt-2 flex flex-col gap-2 text-xl">
                {doses.done.map((d) => (
                  <li key={d.id}>
                    <span aria-hidden="true">{d.status === "taken" || d.status === "administered" ? "✓ " : "– "}</span>
                    {d.medication.name}
                    {d.scheduledFor && ` (${time(d.scheduledFor)})`}: {t(`simple.${statusLabel[d.status as keyof typeof statusLabel]}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="coming-heading" className={card}>
        <h2 id="coming-heading" className={heading}>
          📅 {t("simple.comingUp")}
        </h2>
        {coming.length === 0 ? (
          <p className="text-xl">{t("simple.nothingComing")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {coming.map((c, i) => (
              <li key={i} className="text-xl">
                <p className="font-semibold">{c.text}</p>
                {c.extra && <p>{c.extra}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {active && caps.has("update.post") && (
        <section aria-labelledby="checkin-heading" className={card}>
          <h2 id="checkin-heading" className={heading}>
            {t("simple.howAreYou")}
          </h2>
          <CheckIn
            url={`/api/v1/circles/${circleId}/updates`}
            emergencyNumber={number}
            labels={{
              ...messages,
              ...(Object.fromEntries(
                ["feelFine", "feelUnwell", "needSomething", "tellMore", "send", "back", "sentOk", "sentUnwell", "updateFine", "updateUnwell", "updateNeed"].map((k) => [k, t(`simple.${k}`)]),
              ) as Record<string, string>),
            } as Parameters<typeof CheckIn>[0]["labels"]}
          />
        </section>
      )}

      <section aria-labelledby="call-heading" className={card}>
        <h2 id="call-heading" className={heading}>
          ☎️ {t("simple.callFamily")}
        </h2>
        {contacts.length === 0 ? (
          <p className="text-xl">{t("simple.noContacts")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {contacts.map((c) => (
              <li key={c.id}>
                <a
                  href={`tel:${c.phone}`}
                  className="flex min-h-16 flex-col justify-center rounded-2xl bg-primary px-6 py-2 text-2xl font-bold text-primary-foreground"
                >
                  <span>📞 {t("simple.callName", { name: c.name })}</span>
                  {c.relationship && <span className="text-lg font-normal">{c.relationship}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-lg text-muted">{t("safety.notEmergencyService")}</p>
      <p className="text-sm text-muted">{session.user.name}</p>
    </div>
  );
}
