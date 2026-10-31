import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getRequestTranslator } from "@/i18n/server";
import { getCurrentSession, safeReturnPath } from "@/server/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<p>…</p>}>
      <Login searchParams={searchParams} />
    </Suspense>
  );
}

async function Login({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = safeReturnPath((await searchParams).next);
  if (await getCurrentSession()) redirect(next);
  const { locale, t } = await getRequestTranslator();

  return (
    <div lang={locale}>
      <h1 className="text-3xl font-bold">{t("auth.loginTitle")}</h1>
      <LoginForm
        next={next}
        labels={{
          email: t("auth.email"),
          password: t("auth.password"),
          submit: t("auth.loginSubmit"),
          network: t("common.errorNetwork"),
          generic: t("common.errorGeneric"),
          fixErrors: t("common.fixErrors"),
        }}
      />
      <p className="mt-6">
        {t("auth.loginNoAccount")}{" "}
        <Link href={next === "/app" ? "/register" : `/register?next=${encodeURIComponent(next)}`} className="font-semibold text-primary underline">
          {t("auth.loginCreateAccount")}
        </Link>
      </p>
    </div>
  );
}
