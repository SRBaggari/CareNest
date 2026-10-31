import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-10">
      <Link href="/" className="mb-8 text-2xl font-bold text-primary">
        CareNest
      </Link>
      <main id="main" className="w-full max-w-md rounded-xl border border-border bg-surface p-6 sm:p-8">
        {children}
      </main>
    </div>
  );
}
