import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LOCALE_NAMES, LOCALES } from "@/i18n";
import { getRequestTranslator } from "@/i18n/server";
import { timeZoneOptions } from "@/lib/time-zones";
import { getCurrentSession, safeReturnPath } from "@/server/auth/current-user";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <Suspense fallback={<p>…</p>}>
      <Register searchParams={searchParams} />
    </Suspense>
  );
}

async function Register({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const next = safeReturnPath((await searchParams).next);
  if (await getCurrentSession()) redirect(next);
  const { locale, t } = await getRequestTranslator();

  return (
    <div lang={locale}>
      <h1 className="text-3xl font-bold">{t("auth.registerTitle")}</h1>
      <RegisterForm
        next={next}
        defaultLocale={locale}
        timeZones={timeZoneOptions()}
        locales={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
        labels={{
          name: t("auth.name"),
          email: t("auth.email"),
          password: t("auth.password"),
          passwordHint: t("auth.passwordHint"),
          timeZone: t("auth.timeZone"),
          timeZoneHint: t("auth.timeZoneHint"),
          language: t("auth.language"),
          submit: t("auth.registerSubmit"),
          network: t("common.errorNetwork"),
          generic: t("common.errorGeneric"),
          fixErrors: t("common.fixErrors"),
        }}
      />
      <p className="mt-6">
        {t("auth.registerHaveAccount")}{" "}
        <Link href="/login" className="font-semibold text-primary underline">
          {t("landing.signIn")}
        </Link>
      </p>
    </div>
  );
}
