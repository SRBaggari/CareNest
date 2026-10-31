import Link from "next/link";
import { Suspense } from "react";
import { getRequestTranslator } from "@/i18n/server";

export default function Home() {
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <Landing />
    </Suspense>
  );
}

async function Landing() {
  const { locale, t } = await getRequestTranslator();
  const features = [
    { title: t("landing.featureMedsTitle"), body: t("landing.featureMedsBody") },
    { title: t("landing.featureFamilyTitle"), body: t("landing.featureFamilyBody") },
    { title: t("landing.featureDignityTitle"), body: t("landing.featureDignityBody") },
  ];

  return (
    <div lang={locale} className="flex flex-1 flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface focus:px-4 focus:py-2"
      >
        {t("common.skipToContent")}
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <span className="text-xl font-bold text-primary">{t("app.name")}</span>
          <nav aria-label="Account" className="flex items-center gap-3">
            <Link href="/login" className="rounded-lg px-4 py-3 font-medium underline-offset-4 hover:underline">
              {t("landing.signIn")}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-12">
        <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">{t("app.tagline")}</h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">{t("landing.intro")}</p>
        <Link
          href="/register"
          className="mt-8 inline-flex min-h-12 items-center rounded-lg bg-primary px-6 text-lg font-semibold text-primary-foreground"
        >
          {t("landing.getStarted")}
        </Link>

        <ul className="mt-14 grid gap-6 sm:grid-cols-3">
          {features.map((f) => (
            <li key={f.title} className="rounded-xl border border-border bg-surface p-6">
              <h2 className="text-xl font-semibold">{f.title}</h2>
              <p className="mt-2 text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t border-border bg-surface">
        <p className="mx-auto max-w-5xl px-4 py-6 text-muted">{t("safety.notEmergencyService")}</p>
      </footer>
    </div>
  );
}
