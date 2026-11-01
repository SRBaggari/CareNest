"use client";

import { LifeBuoy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { callApi } from "@/lib/api-client";

type Labels = Record<
  "needHelp" | "confirmTitle" | "confirmBody" | "message" | "shareLocation" | "locationFailed" | "yesAlert" | "cancel" | "sending" | "network" | "generic",
  string
>;

function currentPosition(): Promise<{ latitude: number; longitude: number; accuracyMeters: number | null } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyMeters: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    ),
  );
}

/**
 * Two deliberate steps (press, then confirm) so a stray tap doesn't alarm the family, with large
 * targets throughout. Location is only read if the person ticks the box, for this alert only.
 */
export function HelpButton({ url, circleId, practice, labels }: { url: string; circleId: string; practice?: boolean; labels: Labels }) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "confirm" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function send(form: FormData) {
    setStage("sending");
    setError(null);
    const share = form.get("shareLocation") === "on";
    const location = share ? await currentPosition() : null;
    if (share && !location) setNote(labels.locationFailed);
    const result = await callApi<{ request: { id: string } }>("POST", url, {
      message: String(form.get("message") ?? ""),
      practice: Boolean(practice),
      location,
    });
    if (result.ok) {
      router.push(`/app/circles/${circleId}/emergency/${result.data.request.id}`);
      return;
    }
    setError(result.status === 0 ? labels.network : result.error.message || labels.generic);
    setStage("confirm");
  }

  if (stage === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStage("confirm")}
        className={
          practice
            ? `${buttonClass("secondary")} self-start`
            : "inline-flex min-h-24 w-full items-center justify-center gap-4 rounded-3xl bg-danger px-6 py-3 text-2xl font-bold text-primary-foreground shadow-lg sm:text-3xl shadow-danger/25 transition hover:brightness-110 sm:w-auto sm:min-w-96"
        }
      >
        {!practice && <LifeBuoy aria-hidden="true" className="size-10 shrink-0" strokeWidth={2.4} />}
        {labels.needHelp}
      </button>
    );
  }

  return (
    <form
      action={send}
      className="flex w-full max-w-xl flex-col gap-4 rounded-3xl border-4 border-danger bg-surface p-5 shadow-card"
      aria-labelledby="help-confirm-title"
    >
      <h2 id="help-confirm-title" className="text-2xl font-bold">
        {labels.confirmTitle}
      </h2>
      <p className="text-lg">{labels.confirmBody}</p>
      {error && <Alert tone="error">{error}</Alert>}
      {note && <Alert>{note}</Alert>}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{labels.message}</span>
        <textarea name="message" maxLength={500} className="min-h-24 w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-lg focus:border-primary" />
      </label>
      <label className="flex min-h-14 items-center gap-3 rounded-xl border-2 border-border bg-surface px-4 transition hover:border-primary">
        <input type="checkbox" name="shareLocation" className="size-6" />
        {labels.shareLocation}
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={stage === "sending"}
          aria-busy={stage === "sending" || undefined}
          className={`${buttonClass("dangerSolid", "lg")} min-h-16`}
        >
          {stage === "sending" ? labels.sending : labels.yesAlert}
        </button>
        <button type="button" onClick={() => setStage("idle")} className={`${buttonClass("secondary", "lg")} min-h-16`}>
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}

/** Keeps an open request's status page fresh without the person having to reload. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}
