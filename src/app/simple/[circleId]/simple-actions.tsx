"use client";

import { ArrowLeft, Check, CircleCheck, Frown, HandHelping, Smile } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/api-client";

const big = "inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-3xl px-6 py-2 text-2xl font-bold transition disabled:opacity-60 sm:w-auto";
const primary = `${big} bg-primary text-primary-foreground shadow-sm hover:brightness-110`;
const secondary = `${big} border-4 border-border bg-surface text-foreground hover:border-primary`;
// A big answer button: icon on the left, words beside it, the whole row tappable.
const choice = "flex min-h-20 w-full items-center gap-4 rounded-3xl border-4 border-border bg-surface px-5 py-3 text-left text-2xl font-bold transition hover:border-primary";
const back = "inline-flex min-h-12 items-center gap-2 self-start rounded-xl px-2 text-lg font-semibold underline";
const done = "flex items-start gap-3 rounded-2xl bg-success-soft p-4 text-xl font-bold text-success";

type Messages = { network: string; generic: string };

function useSend(messages: Messages) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    const result = await callApi("POST", url, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.status === 0 ? messages.network : result.error.message || messages.generic);
      return false;
    }
    router.refresh();
    return true;
  }
  return { busy, error, send };
}

/**
 * "Did you take it?" — one large yes; "no" opens a short, plain choice so a stray tap never
 * records a missed dose. "I'll take it later" records nothing.
 */
export function DoseQuestion(props: {
  url: string;
  locale: string;
  labels: Messages & Record<"didYouTake" | "tookIt" | "didNotTake" | "whyNot" | "later" | "skipped" | "refused" | "back" | "savedTaken" | "savedOther", string>;
}) {
  const { labels: l } = props;
  const { busy, error, send } = useSend(l);
  const [step, setStep] = useState<"ask" | "why" | "done">("ask");
  const [message, setMessage] = useState("");

  async function record(status: "taken" | "skipped" | "refused") {
    if (await send(props.url, { status })) {
      const time = new Intl.DateTimeFormat(props.locale, { hour: "numeric", minute: "2-digit" }).format(new Date());
      setMessage(status === "taken" ? l.savedTaken.replace("{time}", time) : l.savedOther);
      setStep("done");
    }
  }

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {step === "done" && (
        <p className={done}>
          <CircleCheck aria-hidden="true" className="mt-0.5 size-7 shrink-0" />
          {message}
        </p>
      )}
      {step === "ask" && (
        <>
          <p className="text-xl font-semibold">{l.didYouTake}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => record("taken")} className={primary}>
              <Check aria-hidden="true" className="size-7 shrink-0" strokeWidth={3} />
              {l.tookIt}
            </button>
            <button type="button" disabled={busy} onClick={() => setStep("why")} className={secondary}>
              {l.didNotTake}
            </button>
          </div>
        </>
      )}
      {step === "why" && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-xl font-semibold">{l.whyNot}</legend>
          <button type="button" onClick={() => setStep("ask")} className={secondary}>
            {l.later}
          </button>
          <button type="button" disabled={busy} onClick={() => record("skipped")} className={secondary}>
            {l.skipped}
          </button>
          <button type="button" disabled={busy} onClick={() => record("refused")} className={secondary}>
            {l.refused}
          </button>
          <button type="button" onClick={() => setStep("ask")} className={back}>
            <ArrowLeft aria-hidden="true" className="size-5" />
            {l.back}
          </button>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-xl font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type Feeling = "fine" | "unwell" | "need";

/** "How are you today?" — three answers; "not well" and "need something" alert the family. */
export function CheckIn(props: {
  url: string;
  emergencyNumber: string;
  labels: Messages & Record<"feelFine" | "feelUnwell" | "needSomething" | "tellMore" | "send" | "back" | "sentOk" | "sentUnwell" | "updateFine" | "updateUnwell" | "updateNeed", string>;
}) {
  const { labels: l } = props;
  const { busy, error, send } = useSend(l);
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [more, setMore] = useState("");

  async function submit(f: Feeling) {
    const text = { fine: l.updateFine, unwell: l.updateUnwell, need: l.updateNeed }[f];
    const ok = await send(props.url, {
      body: more.trim() ? `${text} ${more.trim()}` : text,
      category: f === "unwell" ? "health" : "general",
      important: f !== "fine",
      checkin: f,
    });
    if (ok) {
      setSent(f === "fine" ? l.sentOk : l.sentUnwell.replace("{number}", props.emergencyNumber));
      setFeeling(null);
      setMore("");
    }
  }

  if (sent) {
    return (
      <p aria-live="polite" className={done}>
        <CircleCheck aria-hidden="true" className="mt-0.5 size-7 shrink-0" />
        {sent}
      </p>
    );
  }

  if (!feeling) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={() => setFeeling("fine")} className={choice}>
          <FeelingIcon icon="fine" />
          {l.feelFine}
        </button>
        <button type="button" onClick={() => setFeeling("unwell")} className={choice}>
          <FeelingIcon icon="unwell" />
          {l.feelUnwell}
        </button>
        <button type="button" onClick={() => setFeeling("need")} className={choice}>
          <FeelingIcon icon="need" />
          {l.needSomething}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-4 text-2xl font-bold">
        <FeelingIcon icon={feeling} />
        {{ fine: l.feelFine, unwell: l.feelUnwell, need: l.needSomething }[feeling]}
      </p>
      <label className="flex flex-col gap-2">
        <span className="text-xl">{l.tellMore}</span>
        <textarea value={more} onChange={(e) => setMore(e.target.value)} maxLength={500} className="min-h-28 w-full rounded-2xl border-4 border-border bg-surface p-4 text-xl focus:border-primary" />
      </label>
      <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => submit(feeling)} className={primary}>
        {l.send}
      </button>
      <button type="button" onClick={() => setFeeling(null)} className={back}>
        <ArrowLeft aria-hidden="true" className="size-5" />
        {l.back}
      </button>
      {error && (
        <p role="alert" className="text-xl font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const feelingIcon = {
  fine: { Icon: Smile, tone: "bg-success-soft text-success" },
  unwell: { Icon: Frown, tone: "bg-warning-soft text-warning" },
  need: { Icon: HandHelping, tone: "bg-primary-soft text-primary" },
};

function FeelingIcon({ icon }: { icon: Feeling }) {
  const { Icon, tone } = feelingIcon[icon];
  return (
    <span aria-hidden="true" className={`inline-flex size-12 shrink-0 items-center justify-center rounded-full ${tone}`}>
      <Icon className="size-7" strokeWidth={2.4} />
    </span>
  );
}
