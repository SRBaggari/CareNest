import { afterEach, beforeEach } from "vitest";
import { setSmsTransportForTesting, type SmsTransport } from "@/server/notifications/sms";

/** In-memory SMS service; set `failNext` to make the next sends throw. */
export class FakeSms implements SmsTransport {
  readonly kind = "test" as const;
  sent: { to: string; body: string }[] = [];
  failNext = 0;
  async send(to: string, body: string) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("SMS provider unavailable");
    }
    this.sent.push({ to, body });
  }
  /** The 6-digit code in the latest text to this number. */
  codeFor(to: string) {
    const last = [...this.sent].reverse().find((m) => m.to === to);
    return /\b(\d{6})\b/.exec(last?.body ?? "")?.[1] ?? null;
  }
}

/** Installs a fresh FakeSms for each test (text messages "configured"). */
export function setupFakeSms(): () => FakeSms {
  let transport = new FakeSms();
  beforeEach(() => {
    transport = new FakeSms();
    setSmsTransportForTesting(transport);
  });
  afterEach(() => setSmsTransportForTesting(undefined));
  return () => transport;
}
