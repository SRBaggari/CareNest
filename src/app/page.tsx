import { CalendarDays, CircleCheck, HeartHandshake, Pill, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { IconTile } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <Landing searchParams={searchParams} />
    </Suspense>
  );
}

async function Landing({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const deleted = (await searchParams).deleted === "1";
  const { locale, t } = await getRequestTranslator();
  const features = [
    { icon: Pill, title: t("landing.featureMedsTitle"), body: t("landing.featureMedsBody") },
    { icon: UsersRound, title: t("landing.featureFamilyTitle"), body: t("landing.featureFamilyBody") },
    { icon: HeartHandshake, title: t("landing.featureDignityTitle"), body: t("landing.featureDignityBody") },
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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Logo name={t("app.name")} />
          <nav aria-label={t("common.mainNav")} className="flex items-center gap-2">
            <Link href="/login" className={buttonClass("ghost")}>
              {t("landing.signIn")}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        <div className="relative overflow-hidden bg-gradient-to-b from-primary-soft to-background">
          <div className="mx-auto grid max-w-5xl items-center gap-12 px-4 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr]">
            <div>
              {deleted && (
                <div className="mb-8">
                  <Alert tone="success">{t("data.deleted")}</Alert>
                </div>
              )}
              <h1 className="text-4xl font-bold leading-tight sm:text-5xl">{t("app.tagline")}</h1>
              <p className="mt-6 max-w-2xl text-xl text-muted">{t("landing.intro")}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/register" className={buttonClass("primary", "lg")}>
                  {t("landing.getStarted")}
                </Link>
                <Link href="/login" className={buttonClass("secondary", "lg")}>
                  {t("landing.signIn")}
                </Link>
              </div>
            </div>
            <Illustration />
          </div>
        </div>

        <ul className="mx-auto grid max-w-5xl gap-6 px-4 py-14 sm:grid-cols-3">
          {features.map((f) => (
            <li key={f.title} className="card flex flex-col gap-3">
              <IconTile icon={f.icon} size="lg" />
              <h2 className="text-xl font-bold">{f.title}</h2>
              <p className="text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t border-border bg-surface">
        <p className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-6 text-muted">
          <ShieldCheck aria-hidden="true" className="size-5 shrink-0" />
          {t("safety.notEmergencyService")}
        </p>
      </footer>
    </div>
  );
}

/** A wordless sketch of the app's cards: decorative, so it needs no translation and is hidden from screen readers. */
function Illustration() {
  const bar = "h-3 rounded-full bg-sunken";
  return (
    <div aria-hidden="true" className="relative mx-auto hidden w-full max-w-sm sm:block">
      <div className="card rotate-[-2deg] p-5">
        <div className="flex items-center gap-3">
          <IconTile icon={Pill} />
          <div className={`${bar} w-32`} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="h-14 rounded-xl bg-success-soft" />
          <div className="h-14 rounded-xl bg-primary-soft" />
          <div className="h-14 rounded-xl bg-sunken" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <CircleCheck className="size-5 text-success" />
          <div className={`${bar} w-40`} />
        </div>
      </div>
      <div className="card relative -mt-4 ml-10 rotate-[2deg] p-5">
        <div className="flex items-center gap-3">
          <IconTile icon={CalendarDays} tone="warning" />
          <div className="flex-1 space-y-2">
            <div className={`${bar} w-36`} />
            <div className={`${bar} w-24`} />
          </div>
        </div>
      </div>
    </div>
  );
}
