import { SkipLink } from "@/components/ui/skip-link";
import { Bell, House, UserRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/ui/logo";
import { Toaster } from "@/components/ui/toaster";
import { getRequestTranslator } from "@/i18n/server";
import { requireSession } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { unreadCount } from "@/server/services/notifications";
import { SignOutButton } from "./sign-out-button";

// On phones each item stacks a small label under its icon so they fit beside the logo; labels
// are never dropped, because an icon alone is not enough for everyone. Signing out moves to
// the Account page there, as long words (Tamil "வெளியேறு") leave no room for a fourth item.
const navItem =
  "relative inline-flex min-h-12 min-w-14 max-w-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 text-center text-sm leading-tight font-semibold break-words text-muted hover:bg-sunken hover:text-foreground sm:max-w-none sm:flex-row sm:gap-2 sm:px-3 sm:text-base";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<header className="h-[69px] border-b border-border bg-surface print:hidden" />}>
        <AppHeader />
      </Suspense>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        <Suspense fallback={<p aria-busy="true">…</p>}>{children}</Suspense>
      </main>
      <Suspense>
        <DoneToaster />
      </Suspense>
    </div>
  );
}

async function DoneToaster() {
  const { t } = await getRequestTranslator();
  return <Toaster label={t("common.done")} />;
}

async function AppHeader() {
  const session = await requireSession("/app");
  const { locale, t } = await getRequestTranslator();
  const unread = await unreadCount(await getDb(), session.user.id);
  return (
    <header lang={locale} className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur print:hidden">
      <SkipLink label={t("common.skipToContent")} />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <Link href="/app" aria-label={t("app.name")} className="rounded-xl">
          <Logo name={t("app.name")} compact />
        </Link>
        <nav aria-label={t("common.mainNav")} className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <Link href="/app" className={navItem}>
            <House aria-hidden="true" className="size-5" />
            {t("common.home")}
          </Link>
          <Link
            href="/app/notifications"
            aria-label={unread > 0 ? t("common.notificationsUnread", { count: unread }) : t("common.notifications")}
            className={navItem}
          >
            <Bell aria-hidden="true" className="size-5" />
            <span className="max-sm:sr-only">{t("common.notifications")}</span>
            <span aria-hidden="true" className="sm:hidden">
              {t("common.notificationsShort")}
            </span>
            {unread > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-1 top-0.5 min-w-6 rounded-full bg-danger px-1.5 text-center text-sm font-bold text-primary-foreground sm:static"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          <Link href="/app/account" className={navItem}>
            <UserRound aria-hidden="true" className="size-5" />
            {t("common.account")}
          </Link>
          <SignOutButton label={t("common.signOut")} className={`${navItem} max-sm:hidden`} />
        </nav>
      </div>
    </header>
  );
}
