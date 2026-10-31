import { afterEach, beforeEach } from "vitest";
import { setEmailTransportForTesting, type EmailTransport, type OutgoingEmail } from "@/server/notifications/email";

/** In-memory email transport; set `failNext` to simulate provider errors. */
export class FakeTransport implements EmailTransport {
  readonly kind = "test" as const;
  sent: OutgoingEmail[] = [];
  failNext = 0;
  async send(email: OutgoingEmail) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("SMTP 451 temporary failure");
    }
    this.sent.push(email);
  }
}

/** Installs a fresh FakeTransport for each test in the file. */
export function setupFakeEmail(): () => FakeTransport {
  let transport = new FakeTransport();
  beforeEach(() => {
    transport = new FakeTransport();
    setEmailTransportForTesting(transport);
  });
  afterEach(() => setEmailTransportForTesting(undefined));
  return () => transport;
}
