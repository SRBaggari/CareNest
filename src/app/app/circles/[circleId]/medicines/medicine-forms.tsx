"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Messages = { network: string; generic: string; fixErrors: string };
type Status = "taken" | "administered" | "skipped" | "refused";

const textareaClass = "min-h-24 w-full rounded-xl border-2 border-border bg-surface px-4 focus:border-primary text-lg";

/**
 * One-tap confirmation for "taken"/"given"; skipping or refusing opens a short optional form for a
 * reason. Once recorded, the buttons hide behind "Change this record" so corrections are deliberate.
 */
export function DoseActions(props: {
  url: string;
  recorded: boolean;
  canAdminister: boolean;
  labels: Messages & Record<Status | "change" | "reason" | "note" | "sideEffects" | "confirm" | "cancel", string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, submit } = useApiSubmit(l);
  const [open, setOpen] = useState(!props.recorded);
  const [detailsFor, setDetailsFor] = useState<Status | null>(null);

  async function record(status: Status, extra: Record<string, string> = {}) {
    const ok = await submit("POST", props.url, { status, ...extra });
    if (ok) {
      setDetailsFor(null);
      setOpen(false);
    }
    router.refresh();
  }

  async function onDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await record(detailsFor!, {
      reason: String(f.get("reason") ?? ""),
      note: String(f.get("note") ?? ""),
      sideEffects: String(f.get("sideEffects") ?? ""),
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        {l.change}
      </Button>
    );
  }

  const quick: Status[] = props.canAdminister ? ["taken", "administered"] : ["taken"];
  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      {detailsFor ? (
        <form onSubmit={onDetails} className="flex flex-col gap-3">
          <p className="font-semibold">{l[detailsFor]}</p>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{l.reason}</span>
            <textarea name="reason" className={textareaClass} maxLength={500} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{l.sideEffects}</span>
            <textarea name="sideEffects" className={textareaClass} maxLength={1000} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={pending}>
              {l.confirm}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDetailsFor(null)}>
              {l.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {quick.map((s) => (
            <Button key={s} type="button" busy={pending} onClick={() => record(s)}>
              ✓ {l[s]}
            </Button>
          ))}
          {(["skipped", "refused"] as const).map((s) => (
            <Button key={s} type="button" variant="secondary" busy={pending} onClick={() => setDetailsFor(s)}>
              {l[s]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AsNeededForm(props: {
  url: string;
  canAdminister: boolean;
  labels: Messages & Record<"open" | "when" | "taken" | "administered" | "note" | "sideEffects" | "confirm" | "cancel", string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  const [open, setOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const when = String(f.get("occurredAt") ?? "");
    const ok = await submit("POST", props.url, {
      status: props.canAdminister ? "administered" : "taken",
      occurredAt: when ? new Date(when).toISOString() : undefined,
      note: String(f.get("note") ?? ""),
      sideEffects: String(f.get("sideEffects") ?? ""),
    });
    if (ok) setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
        {l.open}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-3 flex max-w-xl flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={l.when} name="occurredAt" type="datetime-local" errors={fieldErrors.occurredAt} />
      <label className="flex flex-col gap-1">
        <span className="font-medium">{l.note}</span>
        <textarea name="note" className={textareaClass} maxLength={1000} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{l.sideEffects}</span>
        <textarea name="sideEffects" className={textareaClass} maxLength={1000} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={pending}>
          ✓ {props.canAdminister ? l.administered : l.taken}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {l.cancel}
        </Button>
      </div>
    </form>
  );
}

export function RestockForm(props: {
  url: string;
  current: number | null;
  labels: Messages & Record<"open" | "count" | "save" | "cancel", string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  const [open, setOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const count = Number(new FormData(event.currentTarget).get("supplyCount"));
    const ok = await submit("POST", props.url, { supplyCount: count });
    if (ok) setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {l.open}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={l.count} name="supplyCount" type="number" min={0} inputMode="numeric" defaultValue={props.current ?? ""} errors={fieldErrors.supplyCount} />
      <div className="flex gap-2">
        <Button type="submit" busy={pending}>
          {l.save}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {l.cancel}
        </Button>
      </div>
    </form>
  );
}

type MedicationValues = {
  name: string;
  dosage: string;
  instructions: string | null;
  prescriber: string | null;
  startDate: string;
  endDate: string | null;
  asNeeded: boolean;
  times: string[];
  daysOfWeek: number[] | null;
  unitsPerDose: number;
  supplyCount: number | null;
  refillThreshold: number | null;
  version: number;
};

/** Add or edit a medicine exactly as prescribed. */
export function MedicationForm(props: {
  method: "POST" | "PATCH";
  url: string;
  initial?: MedicationValues;
  weekdays: { value: number; label: string }[];
  openLabel: string;
  labels: Messages & Record<string, string>;
}) {
  const { labels: l, initial } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  const [open, setOpen] = useState(false);
  const [asNeeded, setAsNeeded] = useState(initial?.asNeeded ?? false);
  const [times, setTimes] = useState<string[]>(initial?.times.length ? initial.times : ["08:00"]);
  const [days, setDays] = useState<number[] | null>(initial?.daysOfWeek ?? null);

  const optionalNumber = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const body: Record<string, unknown> = {
      name: s("name"),
      dosage: s("dosage"),
      instructions: s("instructions"),
      prescriber: s("prescriber"),
      startDate: s("startDate") || undefined,
      endDate: s("endDate") || null,
      asNeeded,
      times: asNeeded ? [] : times.filter(Boolean),
      daysOfWeek: days && days.length < 7 ? days : null,
      unitsPerDose: optionalNumber(f.get("unitsPerDose")) ?? 1,
      supplyCount: optionalNumber(f.get("supplyCount")),
      refillThreshold: optionalNumber(f.get("refillThreshold")),
    };
    if (initial) body.version = initial.version;
    const ok = await submit(props.method, props.url, body);
    if (ok) setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" variant={initial ? "secondary" : "primary"} className="self-start" onClick={() => setOpen(true)}>
        {props.openLabel}
      </Button>
    );
  }

  const everyDay = days === null;
  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-2xl flex-col gap-5 card border-2 border-primary">
      <p className="text-muted">{l.formIntro}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={l.name} name="name" defaultValue={initial?.name} required errors={fieldErrors.name} />
      <TextField label={l.dosage} hint={l.dosageHint} name="dosage" defaultValue={initial?.dosage} required errors={fieldErrors.dosage} />
      <TextField label={l.instructions} hint={l.instructionsHint} name="instructions" defaultValue={initial?.instructions ?? ""} errors={fieldErrors.instructions} />
      <TextField label={l.prescriberField} name="prescriber" defaultValue={initial?.prescriber ?? ""} errors={fieldErrors.prescriber} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label={l.startDate} name="startDate" type="date" defaultValue={initial?.startDate} errors={fieldErrors.startDate} />
        <TextField label={l.endDate} name="endDate" type="date" defaultValue={initial?.endDate ?? ""} errors={fieldErrors.endDate} />
      </div>

      <label className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border bg-surface transition hover:border-primary px-4">
        <input type="checkbox" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} className="size-6" />
        {l.asNeededField}
      </label>

      {!asNeeded && (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 font-semibold">{l.times}</legend>
            {times.map((time, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label={`${l.times} ${i + 1}`}
                  value={time}
                  onChange={(e) => setTimes(times.map((v, j) => (j === i ? e.target.value : v)))}
                  className="min-h-12 rounded-xl border-2 border-border bg-surface px-4 focus:border-primary text-lg"
                />
                {times.length > 1 && (
                  <Button type="button" variant="secondary" onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                    {l.removeTime.replace("{n}", String(i + 1))}
                  </Button>
                )}
              </div>
            ))}
            {fieldErrors.times && <p className="font-medium text-danger">{fieldErrors.times.join(" ")}</p>}
            {times.length < 12 && (
              <Button type="button" variant="secondary" className="self-start" onClick={() => setTimes([...times, "12:00"])}>
                + {l.addTime}
              </Button>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">{l.days}</legend>
            <label className="flex min-h-12 items-center gap-3">
              <input type="checkbox" checked={everyDay} onChange={(e) => setDays(e.target.checked ? null : [1, 2, 3, 4, 5, 6, 7])} className="size-6" />
              {l.everyDay}
            </label>
            {!everyDay && (
              <div className="flex flex-wrap gap-2">
                {props.weekdays.map((d) => (
                  <label key={d.value} className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-border bg-surface transition hover:border-primary px-3">
                    <input
                      type="checkbox"
                      checked={days!.includes(d.value)}
                      onChange={(e) => setDays(e.target.checked ? [...days!, d.value].sort() : days!.filter((x) => x !== d.value))}
                      className="size-5"
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            )}
            {fieldErrors.daysOfWeek && <p className="font-medium text-danger">{fieldErrors.daysOfWeek.join(" ")}</p>}
          </fieldset>
        </>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <TextField label={l.unitsPerDose} name="unitsPerDose" type="number" min={1} max={20} defaultValue={initial?.unitsPerDose ?? 1} errors={fieldErrors.unitsPerDose} />
        <TextField label={l.supplyCount} name="supplyCount" type="number" min={0} defaultValue={initial?.supplyCount ?? ""} errors={fieldErrors.supplyCount} />
        <TextField label={l.refillThreshold} name="refillThreshold" type="number" min={0} defaultValue={initial?.refillThreshold ?? ""} errors={fieldErrors.refillThreshold} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={pending}>
          {l.save}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {l.cancel}
        </Button>
      </div>
    </form>
  );
}
