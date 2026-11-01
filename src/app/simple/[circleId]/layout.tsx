import { SkipLink } from "@/components/ui/skip-link";
import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { LogoMark } from "@/components/ui/logo";
import { getRequestTranslator } from "@/i18n/server";
import { SignOutButton } from "@/app/app/sign-out-button";

const headerButton =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-border bg-surface px-3 text-base font-semibold leading-tight transition hover:border-primary sm:text-lg";

/**
 * The Simple view's frame: no menus or tabs, larger text throughout, and only two small links
 * (the full app, and signing out) so nothing competes with what the person needs today.
 */
export default function SimpleLayout({ children, params }: LayoutProps<"/simple/[circleId]">) {
  return (
    <div className="flex flex-1 flex-col text-[1.25rem] leading-relaxed">
      <Suspense fallback={<header className="h-[73px] border-b border-border bg-surface" />}>
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
      <SkipLink label={t("common.skipToContent")} />
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="inline-flex items-center gap-3">
          <LogoMark />
          <span className="text-2xl font-bold">{t("app.name")}</span>
        </span>
        <nav aria-label={t("common.mainNav")} className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Link href={`/view?mode=full&next=${encodeURIComponent(`/app/circles/${circleId}`)}`} className={headerButton}>
            <LayoutGrid aria-hidden="true" className="size-5" />
            {t("simple.moreOptions")}
          </Link>
          <SignOutButton label={t("common.signOut")} className={headerButton} />
        </nav>
      </div>
    </header>
  );
}
