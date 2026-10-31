"use client";

import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApiSubmit } from "@/lib/api-client";

export function AcceptInvitation({
  token,
  labels,
}: {
  token: string;
  labels: { accept: string; network: string; generic: string; fixErrors: string };
}) {
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit(labels);

  async function accept() {
    const result = await submit<{ circleId: string }>("POST", `/api/v1/invitations/${token}/accept`);
    if (result) {
      router.replace(`/app/circles/${result.circleId}`);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="button" busy={pending} onClick={accept} className="self-start">
        {labels.accept}
      </Button>
    </div>
  );
}
