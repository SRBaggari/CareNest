import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CareNest", template: "%s · CareNest" },
  description: "Coordinate care for aging parents with your family — medicines, appointments, caregivers and tasks in one place.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The page-level `lang` is set on each page's content wrapper from the user's locale.
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
