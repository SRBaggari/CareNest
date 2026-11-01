import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/ui/logo";
import { SkipLink } from "@/components/ui/skip-link";
import { getRequestTranslator } from "@/i18n/server";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col items-center bg-gradient-to-b from-primary-soft to-background px-4 py-10">
      <Suspense fallback={null}>
        <AuthSkipLink />
      </Suspense>
      <Link href="/" className="mb-8 rounded-xl">
        <Logo name="CareNest" />
      </Link>
      <main id="main" className="card w-full max-w-md sm:p-8">
        {children}
      </main>
    </div>
  );
}

async function AuthSkipLink() {
  const { t } = await getRequestTranslator();
  return <SkipLink label={t("common.skipToContent")} />;
}
