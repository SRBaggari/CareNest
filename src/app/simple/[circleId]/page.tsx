import { CalendarDays, Check, Clock, HeartPulse, Minus, Phone, PhoneCall, Pill, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpButton } from "@/app/app/circles/[circleId]/emergency/help-button";
import { OfflineSupport } from "@/components/offline-support";
import { IconTile } from "@/components/ui/section";
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
import { ReadAloud, VoiceCommands } from "./voice";
import { SPEECH_LANG } from "@/lib/voice";

export const metadata: Metadata = { title: "My day" };

const card = "card flex flex-col gap-5 rounded-3xl";
const heading = "flex items-center gap-3 text-3xl font-bold";

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
  // Today's plan as plain sentences, for reading aloud.
  const greeting = t(`simple.greeting_${greetingFor(now, tz)}`, { name });
  const dateLine = t("simple.todayIs", { date: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now) });
  const spoken = [
    greeting,
    dateLine,
    ...(doses
      ? [
          doses.now.length ? t("voice.medsNow", { list: doses.now.map((d) => `${d.medication.name}, ${d.medication.dosage}`).join("; ") }) : t("simple.medsNone"),
          ...(doses.later.length ? [t("voice.medsLater", { list: doses.later.map((d) => (d.scheduledFor ? `${d.medication.name} ${t("simple.atTime", { time: time(d.scheduledFor) })}` : d.medication.name)).join("; ") })] : []),
        ]
      : []),
    ...coming.map((c) => (c.extra ? `${c.text} ${c.extra}` : c.text)),
    t("voice.helpHint"),
  ];
  const speechLang = SPEECH_LANG[locale] ?? "en-IN";
  const canAnswerDoses = active && caps.has("dose.record");
  const voiceLabels = {
    ...messages,
    updateFine: t("simple.updateFine"),
    updateUnwell: t("simple.updateUnwell"),
    ...(Object.fromEntries(
      ["speak", "notice", "turnOn", "notNow", "turnOff", "tapToSpeak", "listening", "examples", "heard", "confirmTook", "confirmFine", "confirmUnwell", "yes", "no", "notUnderstood", "noDoseNow", "recorded", "helpOpened", "helpAlready", "micBlocked"].map(
        (k) => [k, t(`voice.${k}`)],
      ),
    ) as Record<string, string>),
  } as Parameters<typeof VoiceCommands>[0]["labels"];

  const statusLabel = { taken: "statusTaken", administered: "statusGiven", skipped: "statusSkipped", refused: "statusRefused" } as const;

  return (
    <div lang={locale} className="flex flex-col gap-6">
      <OfflineSupport renderedAt={now.toISOString()} locale={locale} label={t("offline.notice")} />
      <div className="rounded-3xl bg-gradient-to-br from-primary-soft to-surface px-5 py-6">
        <h1 className="text-4xl font-bold leading-tight">{greeting}</h1>
        <p className="mt-2 flex items-center gap-2 text-2xl text-muted">
          <CalendarDays aria-hidden="true" className="size-7 shrink-0" />
          {dateLine}
        </p>
        <div className="mt-4">
          <ReadAloud lang={speechLang} sentences={spoken} labels={{ read: t("voice.readAloud"), stop: t("voice.stop") }} />
        </div>
      </div>

      {/* Help comes first, always. */}
      <section aria-label={t("emergency.title")} className="flex flex-col gap-3">
        {openHelp ? (
          <Link
            href={`/app/circles/${circleId}/emergency/${openHelp.id}`}
            className="inline-flex min-h-20 items-center justify-center rounded-3xl border-4 border-warning bg-warning-soft px-6 text-2xl font-bold"
          >
            {t("emergency.activeTitle")}
          </Link>
        ) : (
          active && caps.has("emergency.raise") && <HelpButton url={`/api/v1/circles/${circleId}/emergency/requests`} circleId={circleId} labels={helpLabels} />
        )}
        <a
          href={`tel:${number}`}
          className="inline-flex min-h-16 items-center justify-center gap-3 rounded-3xl border-4 border-danger bg-surface px-4 py-2 text-xl font-bold text-danger sm:text-2xl transition hover:bg-danger-soft"
        >
          <Phone aria-hidden="true" className="size-7 shrink-0" />
          {t("emergency.call", { number })}
        </a>
      </section>

      {active && (canAnswerDoses || caps.has("update.post")) && (
        <VoiceCommands
          lang={speechLang}
          locale={locale}
          dosesNow={canAnswerDoses && doses ? doses.now.map((d) => ({ url: `/api/v1/circles/${circleId}/doses/${d.id}/record`, name: d.medication.name })) : []}
          checkinUrl={caps.has("update.post") ? `/api/v1/circles/${circleId}/updates` : null}
          labels={voiceLabels}
        />
      )}

      {doses && (
        <section aria-labelledby="meds-heading" className={card}>
          <h2 id="meds-heading" className={heading}>
            <IconTile icon={Pill} size="lg" />
            {t("simple.medsTitle")}
          </h2>
          {doses.now.length === 0 && <p className="text-xl">{t("simple.medsNone")}</p>}
          {doses.now.map((d) => (
            <article key={d.id} className="flex flex-col gap-3 rounded-2xl border-2 border-primary bg-surface p-4">
              {d.scheduledFor && (
                <p className="inline-flex items-center gap-2 self-start rounded-full bg-primary-soft px-4 py-1 text-xl font-bold text-primary">
                  <Clock aria-hidden="true" className="size-5" />
                  {time(d.scheduledFor)}
                </p>
              )}
              <p className="text-3xl font-bold">{d.medication.name}</p>
              <p className="text-xl">{d.medication.dosage}</p>
              {d.medication.instructions && <p className="text-xl text-muted">{d.medication.instructions}</p>}
              {active && caps.has("dose.record") && <DoseQuestion url={`/api/v1/circles/${circleId}/doses/${d.id}/record`} locale={locale} labels={doseLabels} />}
            </article>
          ))}

          {doses.later.length > 0 && (
            <div>
              <h3 className="text-2xl font-bold">{t("simple.laterToday")}</h3>
              <ul className="mt-3 flex flex-col gap-2 text-xl">
                {doses.later.map((d) => (
                  <li key={d.id} className="flex items-baseline gap-3 rounded-2xl bg-sunken px-4 py-3">
                    <span className="shrink-0 font-bold text-primary">{d.scheduledFor && t("simple.atTime", { time: time(d.scheduledFor) })}</span>
                    <span>
                      {d.medication.name} ({d.medication.dosage})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {doses.done.length > 0 && (
            <div>
              <h3 className="text-2xl font-bold">{t("simple.doneToday")}</h3>
              <ul className="mt-3 flex flex-col gap-2 text-xl">
                {doses.done.map((d) => {
                  const ok = d.status === "taken" || d.status === "administered";
                  return (
                    <li key={d.id} className={`flex items-start gap-3 rounded-2xl px-4 py-3 ${ok ? "bg-success-soft" : "bg-sunken"}`}>
                      {ok ? (
                        <Check aria-hidden="true" className="mt-1 size-6 shrink-0 text-success" strokeWidth={3} />
                      ) : (
                        <Minus aria-hidden="true" className="mt-1 size-6 shrink-0 text-muted" strokeWidth={3} />
                      )}
                      <span>
                        {d.medication.name}
                        {d.scheduledFor && ` (${time(d.scheduledFor)})`}: <span className="font-bold">{t(`simple.${statusLabel[d.status as keyof typeof statusLabel]}`)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="coming-heading" className={card}>
        <h2 id="coming-heading" className={heading}>
          <IconTile icon={CalendarDays} size="lg" />
          {t("simple.comingUp")}
        </h2>
        {coming.length === 0 ? (
          <p className="text-xl">{t("simple.nothingComing")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {coming.map((c, i) => (
              <li key={i} className="rounded-2xl bg-sunken px-4 py-3 text-xl">
                <p className="font-bold">{c.text}</p>
                {c.extra && <p>{c.extra}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {active && caps.has("update.post") && (
        <section aria-labelledby="checkin-heading" className={card}>
          <h2 id="checkin-heading" className={heading}>
            <IconTile icon={HeartPulse} size="lg" />
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
          <IconTile icon={UsersRound} size="lg" />
          {t("simple.callFamily")}
        </h2>
        {contacts.length === 0 ? (
          <p className="text-xl">{t("simple.noContacts")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {contacts.map((c) => (
              <li key={c.id}>
                <a
                  href={`tel:${c.phone}`}
                  className="flex min-h-20 items-center gap-4 rounded-3xl bg-primary px-5 py-3 text-primary-foreground shadow-sm transition hover:brightness-110"
                >
                  <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
                    <PhoneCall className="size-6" />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-2xl font-bold">{t("simple.callName", { name: c.name })}</span>
                    {c.relationship && <span className="text-lg">{c.relationship}</span>}
                  </span>
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
