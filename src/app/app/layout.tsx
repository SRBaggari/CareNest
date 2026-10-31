import Link from "next/link";
import { Suspense } from "react";
import { getRequestTranslator } from "@/i18n/server";
import { requireSession } from "@/server/auth/current-user";
import { SignOutButton } from "./sign-out-button";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<header className="h-[73px] border-b border-border bg-surface" />}>
        <AppHeader />
      </Suspense>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Suspense fallback={<p aria-busy="true">…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}

async function AppHeader() {
  await requireSession("/app");
  const { locale, t } = await getRequestTranslator();
  return (
    <header lang={locale} className="border-b border-border bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface focus:px-4 focus:py-2"
      >
        {t("common.skipToContent")}
      </a>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/app" className="text-xl font-bold text-primary">
          {t("app.name")}
        </Link>
        <nav aria-label={t("common.mainNav")} className="flex flex-wrap items-center gap-2">
          <Link href="/app" className="rounded-lg px-3 py-3 font-medium hover:underline">
            {t("common.home")}
          </Link>
          <Link href="/app/account" className="rounded-lg px-3 py-3 font-medium hover:underline">
            {t("common.account")}
          </Link>
          <SignOutButton label={t("common.signOut")} />
        </nav>
      </div>
    </header>
  );
}
