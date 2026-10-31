import type { Metadata } from "next";
import { LOCALE_NAMES, LOCALES } from "@/i18n";
import { getRequestTranslator } from "@/i18n/server";
import { timeZoneOptions } from "@/lib/time-zones";
import { countryOptions } from "@/lib/countries";
import { pageContext } from "@/server/page";
import { NewCircleForm } from "./new-circle-form";

export const metadata: Metadata = { title: "Create a care circle" };

export default async function NewCirclePage() {
  await pageContext("/app/circles/new");
  const { locale, t } = await getRequestTranslator();
  const keys = [
    "circleName", "circleNameHint", "whoCreates", "creatorAdmin", "creatorSelf", "recipientName", "preferredName",
    "preferredNameHint", "dateOfBirth", "timeZone", "timeZoneHint", "country", "countryHint", "language",
    "selfManaging", "selfManagingYes", "selfManagingNo", "selfManagingHint", "create",
  ] as const;
  const labels = Object.fromEntries(keys.map((k) => [k, t(`circle.${k}`)])) as Record<(typeof keys)[number], string>;

  return (
    <div lang={locale} className="max-w-2xl">
      <h1 className="text-3xl font-bold">{t("circle.newTitle")}</h1>
      <p className="mt-2 text-lg text-muted">{t("circle.newIntro")}</p>
      <NewCircleForm
        labels={{
          ...labels,
          optional: t("common.optional"),
          network: t("common.errorNetwork"),
          generic: t("common.errorGeneric"),
          fixErrors: t("common.fixErrors"),
        }}
        timeZones={timeZoneOptions()}
        countries={countryOptions(locale)}
        locales={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
      />
    </div>
  );
}
