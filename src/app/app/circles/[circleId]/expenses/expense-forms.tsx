"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Messages = { network: string; generic: string; fixErrors: string };
type Person = { memberId: string; name: string };
type Option = { value: string; label: string };

const box = "inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-border bg-surface px-3 transition hover:border-primary";

/** Opens the form behind a button, so the page stays calm until someone wants to add something. */
function Opener({ label, onOpen, variant = "primary" }: { label: string; onOpen: () => void; variant?: "primary" | "secondary" }) {
  return (
    <Button type="button" variant={variant} className="self-start" onClick={onOpen}>
      <Plus aria-hidden="true" className="size-5" />
      {label}
    </Button>
  );
}

export function AddExpenseForm(props: {
  url: string;
  people: Person[];
  me: string | null;
  today: string;
  currency: string;
  currencies: string[];
  categories: Option[];
  splitModes: Option[];
  labels: Messages &
    Record<"add" | "description" | "descriptionHint" | "amount" | "currency" | "category" | "spentOn" | "paidBy" | "split" | "sharedBy" | "customHint" | "note" | "save" | "cancel", string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("equal");
  if (!open) return <Opener label={l.add} onOpen={() => setOpen(true)} />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const split =
      mode === "equal"
        ? { mode, members: f.getAll("members").map(String) }
        : mode === "custom"
          ? { mode, shares: props.people.map((p) => ({ memberId: p.memberId, amount: String(f.get(`part-${p.memberId}`) ?? "").trim() })).filter((s) => s.amount !== "") }
          : { mode };
    const ok = await submit("POST", props.url, {
      description: String(f.get("description") ?? ""),
      amount: String(f.get("amount") ?? ""),
      currency: String(f.get("currency")),
      category: String(f.get("category")),
      spentOn: String(f.get("spentOn") ?? ""),
      paidBy: String(f.get("paidBy")),
      split,
      note: String(f.get("note") ?? ""),
    });
    if (ok !== null) setOpen(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={l.description} hint={l.descriptionHint} name="description" maxLength={200} required errors={fieldErrors.description} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <TextField label={l.amount} name="amount" inputMode="decimal" required errors={fieldErrors.amount} />
        <SelectField label={l.currency} name="currency" defaultValue={props.currency} options={props.currencies.map((c) => ({ value: c, label: c }))} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={l.category} name="category" defaultValue="medicine" options={props.categories} />
        <TextField label={l.spentOn} name="spentOn" type="date" defaultValue={props.today} max={props.today} required errors={fieldErrors.spentOn} />
      </div>
      <SelectField label={l.paidBy} name="paidBy" defaultValue={props.me ?? props.people[0]?.memberId} options={props.people.map((p) => ({ value: p.memberId, label: p.name }))} errors={fieldErrors.paidBy} />
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">{l.split}</legend>
        <div className="flex flex-wrap gap-2">
          {props.splitModes.map((m) => (
            <label key={m.value} className={box}>
              <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="size-5" />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      {mode === "equal" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">{l.sharedBy}</legend>
          <div className="flex flex-wrap gap-2">
            {props.people.map((p) => (
              <label key={p.memberId} className={box}>
                <input type="checkbox" name="members" value={p.memberId} defaultChecked className="size-5" />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {mode === "custom" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">{l.sharedBy}</legend>
          <p className="text-base text-muted">{l.customHint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {props.people.map((p) => (
              <TextField key={p.memberId} label={p.name} name={`part-${p.memberId}`} inputMode="decimal" />
            ))}
          </div>
        </fieldset>
      )}
      {fieldErrors.split && <p className="font-medium text-danger">{fieldErrors.split.join(" ")}</p>}
      <TextField label={l.note} name="note" maxLength={500} errors={fieldErrors.note} />
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

export function RecordPaymentForm(props: {
  url: string;
  people: Person[];
  me: string | null;
  today: string;
  currency: string;
  currencies: string[];
  labels: Messages & Record<"recordPayment" | "payFrom" | "payTo" | "amount" | "currency" | "spentOn" | "note" | "savePayment" | "cancel", string>;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  const [open, setOpen] = useState(false);
  if (!open) return <Opener label={l.recordPayment} onOpen={() => setOpen(true)} variant="secondary" />;
  const options = props.people.map((p) => ({ value: p.memberId, label: p.name }));
  const other = props.people.find((p) => p.memberId !== props.me)?.memberId;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const ok = await submit("POST", props.url, {
      fromMember: String(f.get("fromMember")),
      toMember: String(f.get("toMember")),
      amount: String(f.get("amount") ?? ""),
      currency: String(f.get("currency")),
      paidOn: String(f.get("paidOn") ?? ""),
      note: String(f.get("note") ?? ""),
    });
    if (ok !== null) setOpen(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={l.payFrom} name="fromMember" defaultValue={props.me ?? undefined} options={options} errors={fieldErrors.fromMember} />
        <SelectField label={l.payTo} name="toMember" defaultValue={other} options={options} errors={fieldErrors.toMember} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <TextField label={l.amount} name="amount" inputMode="decimal" required errors={fieldErrors.amount} />
        <SelectField label={l.currency} name="currency" defaultValue={props.currency} options={props.currencies.map((c) => ({ value: c, label: c }))} />
      </div>
      <TextField label={l.spentOn} name="paidOn" type="date" defaultValue={props.today} max={props.today} required errors={fieldErrors.paidOn} />
      <TextField label={l.note} name="note" maxLength={500} errors={fieldErrors.note} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={pending}>
          {l.savePayment}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {l.cancel}
        </Button>
      </div>
    </form>
  );
}
