"use client";

import { Bell, BellOff, Send, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { callApi } from "@/lib/api-client";

type Labels = Record<
  "turnOn" | "turnOff" | "on" | "test" | "testSent" | "blocked" | "unsupported" | "subscribeFailed" | "iosHint" | "notConfigured" | "remove" | "network" | "generic",
  string
>;
type State = "checking" | "unsupported" | "ios-needs-home-screen" | "not-configured" | "blocked" | "off" | "on";

/** The browser's push key arrives base64url-encoded; subscribe() wants raw bytes. */
function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** "Chrome on Android" and the like, so people can tell their devices apart on the Account page. */
function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return os ? `${browser} · ${os}` : browser;
}

export function PushDeviceControls({ enabled, publicKey, labels: l }: { enabled: boolean; publicKey: string | null; labels: Labels }) {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check(): Promise<State> {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        // iPhones only offer web push to apps added to the Home Screen.
        const ios = /iPhone|iPad/.test(navigator.userAgent);
        return ios ? "ios-needs-home-screen" : "unsupported";
      }
      if (!enabled || !publicKey) return "not-configured";
      if (Notification.permission === "denied") return "blocked";
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription || Notification.permission !== "granted") return "off";
      // Re-save quietly: if someone else signed in on this browser before, alerts now come to this person.
      await callApi("POST", "/api/v1/me/push-devices", { ...subscription.toJSON(), label: deviceLabel() });
      return "on";
    }
    check().then((s) => !cancelled && setState(s), () => !cancelled && setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, [enabled, publicKey]);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      if ((await Notification.requestPermission()) !== "granted") {
        setState("blocked");
        return;
      }
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) });
      const result = await callApi("POST", "/api/v1/me/push-devices", { ...subscription.toJSON(), label: deviceLabel() });
      if (!result.ok) {
        await subscription.unsubscribe();
        setMessage({ tone: "error", text: result.status === 0 ? l.network : result.error.message || l.generic });
        return;
      }
      setState("on");
      router.refresh();
    } catch {
      // Usually a private/incognito window (Chrome has no push there, by design undetectable) or a
      // push service that couldn't be reached.
      setMessage({ tone: "error", text: l.subscribeFailed });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
      if (subscription) {
        await callApi("DELETE", `/api/v1/me/push-devices?endpoint=${encodeURIComponent(subscription.endpoint)}`);
        await subscription.unsubscribe();
      }
      setState("off");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const result = await callApi("POST", "/api/v1/me/push-devices/test");
    setBusy(false);
    setMessage(result.ok ? { tone: "success", text: l.testSent } : { tone: "error", text: result.status === 0 ? l.network : result.error.message || l.generic });
  }

  const note = { unsupported: l.unsupported, "ios-needs-home-screen": l.iosHint, "not-configured": l.notConfigured, blocked: l.blocked }[state as string];

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {state === "checking" && <p aria-busy="true" className="h-12" />}
      {note && <Alert tone="info">{note}</Alert>}
      {state === "off" && (
        <Button type="button" busy={busy} onClick={turnOn} className="self-start">
          <Bell aria-hidden="true" className="size-5" />
          {l.turnOn}
        </Button>
      )}
      {state === "on" && (
        <>
          <p className="flex items-center gap-2 font-semibold text-success">
            <Smartphone aria-hidden="true" className="size-5" />
            {l.on}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" busy={busy} onClick={test}>
              <Send aria-hidden="true" className="size-5" />
              {l.test}
            </Button>
            <Button type="button" variant="secondary" busy={busy} onClick={turnOff}>
              <BellOff aria-hidden="true" className="size-5" />
              {l.turnOff}
            </Button>
          </div>
        </>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  );
}

/** One row in "Devices with alerts on", with a way to stop alerts to a lost or old device. */
export function RemovePushDevice({ id, label, messages }: { id: string; label: string; messages: { network: string; generic: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    const result = await callApi("DELETE", `/api/v1/me/push-devices/${id}`);
    setBusy(false);
    if (!result.ok) setError(result.status === 0 ? messages.network : result.error.message || messages.generic);
    else router.refresh();
  }
  return (
    <>
      <Button type="button" variant="quietDanger" busy={busy} onClick={remove}>
        {label}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  );
}
