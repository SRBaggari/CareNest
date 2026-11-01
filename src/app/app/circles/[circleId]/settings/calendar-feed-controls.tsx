"use client";

import { CalendarPlus, Copy, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { callApi } from "@/lib/api-client";

type Labels = Record<
  "create" | "linkReady" | "openApp" | "copy" | "copied" | "howTo" | "active" | "lastFetched" | "reset" | "turnOff" | "turnOffConfirm" | "network" | "generic",
  string
>;

/** Make, replace or stop my private calendar link. The link is shown only right after it's made. */
export function CalendarFeedControls(props: { url: string; active: boolean; labels: Labels }) {
  const { labels: l } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; webcalUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function make() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const result = await callApi<{ feed: { url: string; webcalUrl: string } }>("POST", props.url);
    setBusy(false);
    if (!result.ok) return setError(result.status === 0 ? l.network : result.error.message || l.generic);
    setLink(result.data.feed);
    router.refresh();
  }

  async function stop() {
    if (!window.confirm(l.turnOffConfirm)) return;
    setBusy(true);
    const result = await callApi("DELETE", props.url);
    setBusy(false);
    if (!result.ok) return setError(result.status === 0 ? l.network : result.error.message || l.generic);
    setLink(null);
    router.refresh();
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {link && (
        <Alert tone="success">
          <p>{l.linkReady}</p>
          <p className="mt-2 rounded-lg bg-surface p-2 font-mono text-base break-all">{link.url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={link.webcalUrl} className={buttonClass("primary")}>
              <CalendarPlus aria-hidden="true" className="size-5" />
              {l.openApp}
            </a>
            <Button type="button" variant="secondary" onClick={copy}>
              <Copy aria-hidden="true" className="size-5" />
              {copied ? l.copied : l.copy}
            </Button>
          </div>
          <p className="mt-3 text-base text-foreground">{l.howTo}</p>
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {props.active ? (
          <>
            <Button type="button" variant="secondary" busy={busy} onClick={make}>
              <RefreshCw aria-hidden="true" className="size-5" />
              {l.reset}
            </Button>
            <Button type="button" variant="danger" busy={busy} onClick={stop}>
              {l.turnOff}
            </Button>
          </>
        ) : (
          <Button type="button" busy={busy} onClick={make}>
            <CalendarPlus aria-hidden="true" className="size-5" />
            {l.create}
          </Button>
        )}
      </div>
    </div>
  );
}
