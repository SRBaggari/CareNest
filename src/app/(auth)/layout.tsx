import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col items-center bg-gradient-to-b from-primary-soft to-background px-4 py-10">
      <Link href="/" className="mb-8 rounded-xl">
        <Logo name="CareNest" />
      </Link>
      <main id="main" className="card w-full max-w-md sm:p-8">
        {children}
      </main>
    </div>
  );
}
