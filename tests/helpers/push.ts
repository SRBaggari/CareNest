import { afterEach, beforeEach } from "vitest";
import { PushError, setPushTransportForTesting, type PushPayload, type PushTarget, type PushTransport } from "@/server/notifications/push";

/** In-memory push service; set `failNext` to a status code (e.g. 410, 500) to simulate errors. */
export class FakePush implements PushTransport {
  readonly kind = "test" as const;
  sent: { target: PushTarget; payload: PushPayload }[] = [];
  failNext: number[] = [];
  async send(target: PushTarget, payload: PushPayload) {
    const status = this.failNext.shift();
    if (status) throw new PushError(`Push service returned ${status}`, status);
    this.sent.push({ target, payload });
  }
}

/** Installs a fresh FakePush for each test (phone alerts "configured"). */
export function setupFakePush(): () => FakePush {
  let transport = new FakePush();
  beforeEach(() => {
    transport = new FakePush();
    setPushTransportForTesting(transport);
  });
  afterEach(() => setPushTransportForTesting(undefined));
  return () => transport;
}

let n = 0;
/** A subscription body as a browser would send it, with a unique FCM endpoint. */
export function browserSubscription(label = "Chrome · Android") {
  n++;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${Date.now()}-${n}`,
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
    label,
  };
}
