import type { Metadata } from "next";
import { LOCALE_NAMES, LOCALES } from "@/i18n";
import { getRequestTranslator } from "@/i18n/server";
import { timeZoneOptions } from "@/lib/time-zones";
import { requireSession } from "@/server/auth/current-user";
import { listUserSessions } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { emailDeliveryConfigured } from "@/server/notifications/email";
import { getPreferences } from "@/server/services/notifications";
import { DeviceList, PasswordForm, ProfileForm } from "./account-forms";
import { DeleteAccountForm } from "./delete-account-form";
import { NotificationPreferencesForm } from "./notification-preferences-form";
import { SignOutButton } from "../sign-out-button";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await requireSession("/app/account");
  const { locale, t } = await getRequestTranslator();
  const now = new Date();
  const db = await getDb();
  const devices = await listUserSessions(db, session.user.id, now);
  const preferences = await getPreferences(db, session.user.id);
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: session.user.timeZone,
  });

  const common = {
    network: t("common.errorNetwork"),
    generic: t("common.errorGeneric"),
    fixErrors: t("common.fixErrors"),
    save: t("common.save"),
    saved: t("common.saved"),
  };

  return (
    <div lang={locale} className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t("account.title")}</h1>
        {/* On phones the header has no room for it, so signing out lives here. */}
        <SignOutButton label={t("common.signOut")} />
      </div>

      <section aria-labelledby="profile-heading" className="card">
        <h2 id="profile-heading" className="text-2xl font-semibold">
          {t("account.profile")}
        </h2>
        <ProfileForm
          user={session.user}
          timeZones={timeZoneOptions()}
          locales={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
          labels={{ ...common, name: t("auth.name"), timeZone: t("auth.timeZone"), language: t("auth.language") }}
        />
      </section>

      <section aria-labelledby="notif-heading" className="card">
        <h2 id="notif-heading" className="text-2xl font-semibold">
          {t("prefs.title")}
        </h2>
        <p className="mt-2 text-muted">{t("prefs.intro")}</p>
        {!emailDeliveryConfigured() && <p className="mt-2 font-medium text-warning">{t("prefs.noEmailProvider")}</p>}
        <NotificationPreferencesForm
          preferences={preferences}
          labels={{
            ...common,
            email: t("prefs.email"),
            digest: t("prefs.digest"),
            digestHint: t("prefs.digestHint"),
            quietTitle: t("prefs.quietTitle"),
            quietIntro: t("prefs.quietIntro"),
            quietStart: t("prefs.quietStart"),
            quietEnd: t("prefs.quietEnd"),
          }}
        />
      </section>

      <section aria-labelledby="password-heading" className="card">
        <h2 id="password-heading" className="text-2xl font-semibold">
          {t("account.security")}
        </h2>
        <PasswordForm
          labels={{
            ...common,
            currentPassword: t("account.currentPassword"),
            newPassword: t("account.newPassword"),
            passwordHint: t("auth.passwordHint"),
            submit: t("account.changePassword"),
            changed: t("account.passwordChanged"),
          }}
        />
      </section>

      <section aria-labelledby="devices-heading" className="card">
        <h2 id="devices-heading" className="text-2xl font-semibold">
          {t("account.devices")}
        </h2>
        <p className="mt-2 text-muted">{t("account.devicesIntro")}</p>
        <DeviceList
          devices={devices.map((d) => ({
            id: d.id,
            current: d.id === session.sessionId,
            description: d.userAgent ?? t("account.unknownDevice"),
            lastActive: t("account.lastActive", { time: formatter.format(d.lastSeenAt) }),
          }))}
          labels={{ ...common, thisDevice: t("account.thisDevice"), signOutDevice: t("account.signOutDevice") }}
        />
      </section>
      <section aria-labelledby="data-heading" className="card">
        <h2 id="data-heading" className="text-2xl font-semibold">
          {t("data.title")}
        </h2>
        <p className="mt-2 text-muted">{t("data.intro")}</p>
        <a
          href="/api/v1/me/export"
          download
          className="mt-4 inline-flex min-h-12 items-center rounded-lg border-2 border-primary px-5 font-semibold text-primary"
        >
          ⬇ {t("data.download")}
        </a>
        <p className="mt-2 text-muted">{t("data.downloadHint")}</p>
      </section>

      <section aria-labelledby="delete-heading" className="card border-2 border-danger">
        <h2 id="delete-heading" className="text-2xl font-semibold">
          {t("data.deleteTitle")}
        </h2>
        <p className="mt-2">{t("data.deleteIntro")}</p>
        <p className="mt-2 font-medium">{t("data.deleteLastManager")}</p>
        <DeleteAccountForm
          labels={{
            network: common.network,
            generic: common.generic,
            fixErrors: common.fixErrors,
            password: t("data.password"),
            confirmLabel: t("data.confirmLabel"),
            deleteButton: t("data.deleteButton"),
          }}
        />
      </section>
    </div>
  );
}
