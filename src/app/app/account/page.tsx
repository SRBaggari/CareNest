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
import { NotificationPreferencesForm } from "./notification-preferences-form";

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
      <h1 className="text-3xl font-bold">{t("account.title")}</h1>

      <section aria-labelledby="profile-heading" className="rounded-xl border border-border bg-surface p-6">
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

      <section aria-labelledby="notif-heading" className="rounded-xl border border-border bg-surface p-6">
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
            quietTitle: t("prefs.quietTitle"),
            quietIntro: t("prefs.quietIntro"),
            quietStart: t("prefs.quietStart"),
            quietEnd: t("prefs.quietEnd"),
          }}
        />
      </section>

      <section aria-labelledby="password-heading" className="rounded-xl border border-border bg-surface p-6">
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

      <section aria-labelledby="devices-heading" className="rounded-xl border border-border bg-surface p-6">
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
    </div>
  );
}
