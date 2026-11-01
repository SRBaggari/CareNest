"use client";

import { MessageSquareText } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useApiSubmit } from "@/lib/api-client";

type Sms = { available: boolean; phone: string | null; verified: boolean; urgentOnly: boolean };
type Labels = Record<
  | "unavailable"
  | "phone"
  | "phoneHint"
  | "sendCode"
  | "codeSent"
  | "code"
  | "confirm"
  | "resend"
  | "on"
  | "which"
  | "urgentOnly"
  | "allAlerts"
  | "save"
  | "remove"
  | "removeConfirm"
  | "change"
  | "network"
  | "generic"
  | "fixErrors",
  string
>;

const option = "flex min-h-12 items-center gap-3 rounded-xl border-2 border-border bg-surface px-4 transition hover:border-primary";

/** Add a number, confirm it with the texted code, choose which alerts are texted, or stop. */
export function SmsControls({ initial, labels: l }: { initial: Sms; labels: Labels }) {
  const [sms, setSms] = useState(initial);
  const [changing, setChanging] = useState(false);
  const { pending, error, fieldErrors, submit } = useApiSubmit(l);
  if (!sms.available) return <p className="font-medium text-muted">{l.unavailable}</p>;

  async function sendCode(phone: string) {
    const next = await submit<Sms>("PUT", "/api/v1/me/sms", { phone });
    if (next) {
      setSms(next);
      setChanging(false);
    }
  }

  // No number yet (or replacing it).
  if (!sms.phone || changing) {
    return (
      <form
        noValidate
        className="flex max-w-xl flex-col gap-4"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          void sendCode(String(new FormData(e.currentTarget).get("phone") ?? ""));
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label={l.phone} hint={l.phoneHint} name="phone" type="tel" autoComplete="tel" inputMode="tel" required errors={fieldErrors.phone} />
        <Button type="submit" busy={pending} className="self-start">
          <MessageSquareText aria-hidden="true" className="size-5" />
          {l.sendCode}
        </Button>
      </form>
    );
  }

  // A code was sent and is waiting.
  if (!sms.verified) {
    return (
      <form
        noValidate
        className="flex max-w-xl flex-col gap-4"
        onSubmit={async (e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const next = await submit<Sms>("POST", "/api/v1/me/sms/verify", { code: String(new FormData(e.currentTarget).get("code") ?? "") });
          if (next) setSms(next);
        }}
      >
        <p className="font-semibold">{l.codeSent.replace("{phone}", sms.phone)}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label={l.code} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required errors={fieldErrors.code} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={pending}>
            {l.confirm}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setChanging(true)}>
            {l.change}
          </Button>
        </div>
      </form>
    );
  }

  // On: choose which alerts, or stop.
  return (
    <div className="flex flex-col gap-4">
      <p className="font-semibold text-success">{l.on.replace("{phone}", sms.phone)}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <form
        className="flex max-w-xl flex-col gap-3"
        onSubmit={async (e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const next = await submit<Sms>("PATCH", "/api/v1/me/sms", { urgentOnly: new FormData(e.currentTarget).get("which") === "urgent" });
          if (next) setSms(next);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">{l.which}</legend>
          <label className={option}>
            <input type="radio" name="which" value="urgent" defaultChecked={sms.urgentOnly} className="size-5" />
            {l.urgentOnly}
          </label>
          <label className={option}>
            <input type="radio" name="which" value="all" defaultChecked={!sms.urgentOnly} className="size-5" />
            {l.allAlerts}
          </label>
        </fieldset>
        <Button type="submit" variant="secondary" busy={pending} className="self-start">
          {l.save}
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={() => setChanging(true)}>
          {l.change}
        </Button>
        <Button
          type="button"
          variant="quietDanger"
          onClick={async () => {
            if (!window.confirm(l.removeConfirm)) return;
            if ((await submit("DELETE", "/api/v1/me/sms")) !== null) setSms({ ...sms, phone: null, verified: false, urgentOnly: true });
          }}
        >
          {l.remove}
        </Button>
      </div>
    </div>
  );
}
