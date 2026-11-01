"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, where "Save as PDF" is also offered. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="primary" onClick={() => window.print()}>
      <Printer aria-hidden="true" className="size-5" />
      {label}
    </Button>
  );
}
