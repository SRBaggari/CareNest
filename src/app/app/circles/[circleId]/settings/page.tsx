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
import { PrivacyForm, ProfileEditForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings & privacy" };

export default async function SettingsPage({ params }: PageProps<"/app/circles/[circleId]/settings">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}/settings`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const alerts = await getMyAlertSettings(ctx, circleId);
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
      {caps.has("circle.manage") && active && (
        <section aria-labelledby="profile-heading" className="rounded-xl border border-border bg-surface p-6">
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

      <section aria-labelledby="alerts-heading" className="rounded-xl border border-border bg-surface p-6">
        <h2 id="alerts-heading" className="text-2xl font-semibold">
          {t("alerts.title")}
        </h2>
        {alerts.canReceiveMedicationAlerts ? (
          <>
            <p className="mt-2 text-muted">{t("alerts.intro", { name })}</p>
            {role === "admin" && <p className="mt-2 text-muted">{t("alerts.escalationNote")}</p>}
            <AlertSettingsForm
              url={`/api/v1/circles/${circleId}/my-alerts`}
              settings={alerts.settings}
              labels={{
                ...messages,
                doseReminders: t("alerts.doseReminders"),
                unconfirmedDoses: t("alerts.unconfirmedDoses"),
                refills: t("alerts.refills"),
                save: t("common.save"),
                saved: t("common.saved"),
              }}
            />
          </>
        ) : (
          <p className="mt-2">{t("alerts.notShared", { name })}</p>
        )}
      </section>

      <section aria-labelledby="privacy-heading" className="rounded-xl border border-border bg-surface p-6">
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
            save: t("circle.savePrivacy"),
            saved: t("common.saved"),
            yes: t("common.yes"),
            no: t("common.no"),
          }}
        />
      </section>

      <section aria-labelledby="autonomy-heading" className="rounded-xl border border-border bg-surface p-6">
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

      {caps.has("circle.manage") && active && (
        <section aria-labelledby="archive-heading" className="rounded-xl border-2 border-warning bg-surface p-6">
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
