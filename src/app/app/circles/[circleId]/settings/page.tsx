import type { Metadata } from "next";
import { ActionButton } from "@/components/action-button";
import { LOCALE_NAMES, LOCALES } from "@/i18n";
import { getRequestTranslator } from "@/i18n/server";
import { countryOptions } from "@/lib/countries";
import { timeZoneOptions } from "@/lib/time-zones";
import { orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { getMyAlertSettings } from "@/server/services/notifications";
import { AlertSettingsForm } from "./alert-settings-form";
import { CalendarFeedControls } from "./calendar-feed-controls";
import { getCalendarFeed } from "@/server/services/calendar";
import { formatDateTime } from "@/lib/format";
import { PrivacyForm, ProfileEditForm } from "./settings-forms";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Settings & privacy" };

export default async function SettingsPage({ params }: PageProps<"/app/circles/[circleId]/settings">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}/settings`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const [alerts, calendar] = await Promise.all([getMyAlertSettings(ctx, circleId), getCalendarFeed(ctx, circleId)]);
  const { locale, t } = await getRequestTranslator();
  const p = circle.profile;
  const name = p.preferredName ?? p.displayName;
  const caps = new Set(circle.myCapabilities);
  const active = circle.status === "active";
  const role = circle.myMembership.role;
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };

  // Mirrors the server rules in setSelfManaging; the server remains the authority.
  const isRep = circle.myMembership.isLegalRepresentative;
  const canHandOver = role === "care_recipient" || isRep || (role === "admin" && !p.hasOwnAccount);
  const canRestore = role === "admin" || isRep;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("circle.settings")} />
      {caps.has("circle.manage") && active && (
        <section aria-labelledby="profile-heading" className="card">
          <h2 id="profile-heading" className="text-2xl font-semibold">
            {t("circle.profileTitle")}
          </h2>
          <ProfileEditForm
            url={`/api/v1/circles/${circleId}`}
            circle={{ name: circle.name, ...p }}
            timeZones={timeZoneOptions()}
            countries={countryOptions(locale)}
            locales={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
            labels={{
              ...messages,
              circleName: t("circle.circleName"),
              displayName: t("circle.recipientName"),
              preferredName: t("circle.preferredName"),
              dateOfBirth: t("circle.dateOfBirth"),
              timeZone: t("circle.timeZone"),
              country: t("circle.country"),
              language: t("circle.language"),
              emergencyNumber: t("circle.emergencyNumber"),
              save: t("common.save"),
              saved: t("common.saved"),
            }}
          />
        </section>
      )}

      <section aria-labelledby="alerts-heading" className="card">
        <h2 id="alerts-heading" className="text-2xl font-semibold">
          {t("alerts.title")}
        </h2>
        {alerts.available.length > 0 ? (
          <>
            <p className="mt-2 text-muted">{t("alerts.introGeneral", { name })}</p>
            <p className="mt-2 text-muted">{t("alerts.commitments")}</p>
            {role === "admin" && alerts.canReceiveMedicationAlerts && <p className="mt-2 text-muted">{t("alerts.escalationNote")}</p>}
            <AlertSettingsForm
              url={`/api/v1/circles/${circleId}/my-alerts`}
              kinds={alerts.available}
              settings={alerts.settings}
              labels={{
                ...messages,
                doseReminders: t("alerts.doseReminders"),
                unconfirmedDoses: t("alerts.unconfirmedDoses"),
                refills: t("alerts.refills"),
                appointments: t("alerts.appointments", { name }),
                tasks: t("alerts.tasks"),
                save: t("common.save"),
                saved: t("common.saved"),
              }}
            />
          </>
        ) : (
          <p className="mt-2">{t("alerts.noneAvailable")}</p>
        )}
        {/* Family and admins lose medicine alerts when the parent keeps medicines private; say why. */}
        {!alerts.canReceiveMedicationAlerts && (role === "admin" || role === "family") && <p className="mt-2">{t("alerts.notShared", { name })}</p>}
      </section>

      <section aria-labelledby="calendar-heading" className="card">
        <h2 id="calendar-heading" className="text-2xl font-semibold">
          {t("calendar.title")}
        </h2>
        <p className="mt-2 text-muted">{t("calendar.intro", { name })}</p>
        <p className="mt-2 text-muted">{t("calendar.privacy")}</p>
        {calendar.active && (
          <p className="mt-2 font-medium">
            {t("calendar.active", { date: formatDateTime(calendar.createdAt, locale, p.timeZone) })}{" "}
            {calendar.lastFetchedAt ? t("calendar.lastFetched", { date: formatDateTime(calendar.lastFetchedAt, locale, p.timeZone) }) : t("calendar.neverFetched")}
          </p>
        )}
        <CalendarFeedControls
          url={`/api/v1/circles/${circleId}/calendar-feed`}
          active={calendar.active}
          labels={{
            network: t("common.errorNetwork"),
            generic: t("common.errorGeneric"),
            ...(Object.fromEntries(
              (["create", "linkReady", "openApp", "copy", "copied", "howTo", "active", "lastFetched", "reset", "turnOff", "turnOffConfirm"] as const).map((k) => [k, t(`calendar.${k}`)]),
            ) as Record<string, string>),
          } as Parameters<typeof CalendarFeedControls>[0]["labels"]}
        />
      </section>

      <section aria-labelledby="privacy-heading" className="card">
        <h2 id="privacy-heading" className="text-2xl font-semibold">
          {t("circle.privacyTitle")}
        </h2>
        <p className="mt-2 text-muted">{t("circle.privacyIntro")}</p>
        <p className="mt-2 font-medium">{p.selfManaging ? t("circle.privacyOwner", { name }) : t("circle.privacyAdmin", { name })}</p>
        <PrivacyForm
          url={`/api/v1/circles/${circleId}/consent`}
          consent={p.consent}
          editable={caps.has("consent.manage") && active}
          labels={{
            ...messages,
            shareMedications: t("circle.shareMedications"),
            shareAppointments: t("circle.shareAppointments"),
            shareHealth: t("circle.shareHealth"),
            allowAssistant: t("assistant.consentLabel"),
            save: t("circle.savePrivacy"),
            saved: t("common.saved"),
            yes: t("common.yes"),
            no: t("common.no"),
          }}
        />
      </section>

      <section aria-labelledby="autonomy-heading" className="card">
        <h2 id="autonomy-heading" className="text-2xl font-semibold">
          {t("circle.autonomyTitle")}
        </h2>
        <p className="mt-2">{p.selfManaging ? t("circle.autonomyOn", { name }) : t("circle.autonomyOff", { name })}</p>
        {active && (p.selfManaging ? canHandOver : canRestore) && (
          <div className="mt-4">
            <ActionButton
              method="PUT"
              url={`/api/v1/circles/${circleId}/self-managing`}
              body={{ selfManaging: !p.selfManaging, version: p.version }}
              confirm={t("circle.autonomyConfirm")}
              messages={messages}
            >
              {p.selfManaging ? t("circle.autonomyHandOver") : t("circle.autonomyRestore")}
            </ActionButton>
          </div>
        )}
      </section>

      {caps.has("circle.manage") && (
        <section aria-labelledby="export-heading" className="card">
          <h2 id="export-heading" className="text-2xl font-semibold">
            {t("data.circleExport")}
          </h2>
          <p className="mt-2 text-muted">{t("data.circleExportHint")}</p>
          <a
            href={`/api/v1/circles/${circleId}/export`}
            download
            className="mt-4 inline-flex min-h-12 items-center rounded-lg border-2 border-primary px-5 font-semibold text-primary"
          >
            ⬇ {t("data.circleExport")}
          </a>
        </section>
      )}

      {caps.has("circle.manage") && active && (
        <section aria-labelledby="archive-heading" className="card border-2 border-warning">
          <h2 id="archive-heading" className="text-2xl font-semibold">
            {t("circle.archiveTitle")}
          </h2>
          <p className="mt-2 text-muted">{t("circle.archiveIntro")}</p>
          <div className="mt-4">
            <ActionButton
              method="POST"
              url={`/api/v1/circles/${circleId}/archive`}
              confirm={t("circle.archiveConfirm")}
              variant="danger"
              messages={messages}
            >
              {t("circle.archive")}
            </ActionButton>
          </div>
        </section>
      )}
    </div>
  );
}
