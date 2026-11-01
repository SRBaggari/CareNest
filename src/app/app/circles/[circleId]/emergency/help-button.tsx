"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
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
            ? "min-h-12 self-start rounded-xl border-2 border-border bg-surface transition hover:border-primary px-5 font-semibold"
            : "min-h-24 w-full rounded-2xl bg-danger px-6 text-3xl font-bold text-primary-foreground sm:w-auto sm:min-w-96"
        }
      >
        {practice ? labels.needHelp : `⚠ ${labels.needHelp}`}
      </button>
    );
  }

  return (
    <form
      action={send}
      className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border-4 border-danger bg-surface p-5"
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
        <textarea name="message" maxLength={500} className="min-h-20 w-full rounded-xl border-2 border-border bg-surface px-4 focus:border-primary text-lg" />
      </label>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border bg-surface transition hover:border-primary px-4">
        <input type="checkbox" name="shareLocation" className="size-6" />
        {labels.shareLocation}
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={stage === "sending"}
          aria-busy={stage === "sending" || undefined}
          className="min-h-16 rounded-xl bg-danger px-6 text-xl font-bold text-primary-foreground disabled:opacity-60"
        >
          {stage === "sending" ? labels.sending : labels.yesAlert}
        </button>
        <button type="button" onClick={() => setStage("idle")} className="min-h-16 rounded-xl border-2 border-border px-6 text-xl font-semibold">
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
