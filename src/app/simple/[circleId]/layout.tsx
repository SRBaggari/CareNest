import Link from "next/link";
import { Suspense } from "react";
import { getRequestTranslator } from "@/i18n/server";
import { SignOutButton } from "@/app/app/sign-out-button";

/**
 * The Simple view's frame: no menus or tabs, larger text throughout, and only two small links
 * (the full app, and signing out) so nothing competes with what the person needs today.
 */
export default function SimpleLayout({ children, params }: LayoutProps<"/simple/[circleId]">) {
  return (
    <div className="flex flex-1 flex-col text-[1.25rem] leading-relaxed">
      <Suspense fallback={<header className="h-20 border-b border-border bg-surface" />}>
        <SimpleHeader params={params} />
      </Suspense>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <Suspense fallback={<p aria-busy="true">…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}

async function SimpleHeader({ params }: { params: LayoutProps<"/simple/[circleId]">["params"] }) {
  const { circleId } = await params;
  const { locale, t } = await getRequestTranslator();
  return (
    <header lang={locale} className="border-b border-border bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface focus:px-4 focus:py-2"
      >
        {t("common.skipToContent")}
      </a>
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="text-2xl font-bold text-primary">{t("app.name")}</span>
        <nav aria-label={t("common.mainNav")} className="flex flex-wrap items-center gap-2 text-lg">
          <Link
            href={`/view?mode=full&next=${encodeURIComponent(`/app/circles/${circleId}`)}`}
            className="inline-flex min-h-12 items-center rounded-lg px-3 font-medium underline"
          >
            {t("simple.moreOptions")}
          </Link>
          <SignOutButton label={t("common.signOut")} />
        </nav>
      </div>
    </header>
  );
}
