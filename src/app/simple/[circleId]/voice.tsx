"use client";

import { Mic, MicOff, Square, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { callApi } from "@/lib/api-client";
import { matchCommand, type VoiceCommand } from "@/lib/voice";

const big = "inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-3xl px-6 py-2 text-2xl font-bold transition disabled:opacity-60 sm:w-auto";
const primary = `${big} bg-primary text-primary-foreground shadow-sm hover:brightness-110`;
const secondary = `${big} border-4 border-border bg-surface text-foreground hover:border-primary`;
const quiet = "inline-flex min-h-12 items-center gap-2 self-start rounded-xl px-2 text-lg font-semibold underline";

// --- Reading aloud ------------------------------------------------------------------------------

/** The name of a voice for this language on this device, or "" when there is none (or no speech at all). */
function useVoiceFor(lang: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof speechSynthesis === "undefined") return () => {};
      speechSynthesis.addEventListener("voiceschanged", onChange);
      return () => speechSynthesis.removeEventListener("voiceschanged", onChange);
    },
    () => {
      if (typeof speechSynthesis === "undefined") return "";
      const base = lang.split("-")[0];
      const voices = speechSynthesis.getVoices();
      return (voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)))?.name ?? "";
    },
    () => "",
  );
}

/**
 * Reads today's plan aloud in the person's language. Shown only when the device has a voice for
 * that language: a Telugu plan read by an English voice would be worse than nothing.
 */
export function ReadAloud({ lang, sentences, labels }: { lang: string; sentences: string[]; labels: { read: string; stop: string } }) {
  const voiceName = useVoiceFor(lang);
  const [speaking, setSpeaking] = useState(false);
  if (!voiceName) return null;

  function read() {
    speechSynthesis.cancel();
    const voice = speechSynthesis.getVoices().find((v) => v.name === voiceName);
    sentences.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 0.9; // a little slower than default: easier to follow
      if (i === sentences.length - 1) u.onend = () => setSpeaking(false);
      speechSynthesis.speak(u);
    });
    setSpeaking(true);
  }
  function stop() {
    speechSynthesis.cancel();
    setSpeaking(false);
  }

  return speaking ? (
    <button type="button" onClick={stop} className={secondary}>
      <Square aria-hidden="true" className="size-7 shrink-0" />
      {labels.stop}
    </button>
  ) : (
    <button type="button" onClick={read} className={secondary}>
      <Volume2 aria-hidden="true" className="size-7 shrink-0" />
      {labels.read}
    </button>
  );
}

// --- Speaking instead of tapping -----------------------------------------------------------------

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const SETTING = "carenest:voice-commands";
const SETTING_EVENT = "carenest:voice-setting";

/** Whether this person turned speaking on, on this device. Storage may be unavailable: then it's off. */
function useVoiceSetting(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(SETTING_EVENT, onChange);
      return () => window.removeEventListener(SETTING_EVENT, onChange);
    },
    () => {
      try {
        return localStorage.getItem(SETTING) === "on";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const set = (value: boolean) => {
    try {
      if (value) localStorage.setItem(SETTING, "on");
      else localStorage.removeItem(SETTING);
    } catch {
      // Private browsing: the choice lasts for this page only.
    }
    window.dispatchEvent(new Event(SETTING_EVENT));
  };
  return [on, set];
}

const supportedSnapshot = () => recognitionClass() !== null;

type Labels = Record<
  | "speak"
  | "notice"
  | "turnOn"
  | "notNow"
  | "turnOff"
  | "tapToSpeak"
  | "listening"
  | "examples"
  | "heard"
  | "confirmTook"
  | "confirmFine"
  | "confirmUnwell"
  | "yes"
  | "no"
  | "notUnderstood"
  | "noDoseNow"
  | "recorded"
  | "helpOpened"
  | "helpAlready"
  | "micBlocked"
  | "network"
  | "generic"
  | "updateFine"
  | "updateUnwell",
  string
>;

/**
 * "Speak instead of tapping": off until the person turns it on (with a plain notice that the browser
 * may send their voice to its maker). Every command is confirmed on screen before anything is saved,
 * and "I need help" opens the same confirmation as the red Help button.
 */
export function VoiceCommands(props: {
  lang: string;
  locale: string;
  dosesNow: { url: string; name: string }[];
  checkinUrl: string | null;
  labels: Labels;
}) {
  const { labels: l } = props;
  const router = useRouter();
  const supported = useSyncExternalStore(() => () => {}, supportedSnapshot, () => false);
  const [on, setOn] = useVoiceSetting();
  const [stage, setStage] = useState<"idle" | "notice" | "listening" | "confirm" | "busy">("idle");
  const [heard, setHeard] = useState("");
  const [command, setCommand] = useState<VoiceCommand | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const rec = useRef<Recognition | null>(null);
  if (!supported) return null;

  function listen() {
    const Rec = recognitionClass();
    if (!Rec) return;
    setMessage(null);
    const r = new Rec();
    r.lang = props.lang;
    r.interimResults = false;
    r.maxAlternatives = 3;
    let understood = false;
    r.onresult = (e) => {
      const alternatives = Array.from(e.results[0] ?? []).map((a) => a.transcript);
      const match = alternatives.map((text) => ({ text, cmd: matchCommand(text, props.locale) })).find((m) => m.cmd) ?? { text: alternatives[0] ?? "", cmd: null };
      understood = true;
      setHeard(match.text);
      act(match.cmd);
    };
    r.onerror = (e) => {
      understood = true;
      setStage("idle");
      setMessage({ tone: "error", text: e.error === "not-allowed" || e.error === "service-not-allowed" ? l.micBlocked : l.notUnderstood });
    };
    r.onend = () => {
      if (!understood) {
        setStage("idle");
        setMessage({ tone: "error", text: l.notUnderstood });
      }
    };
    rec.current = r;
    setStage("listening");
    r.start();
  }

  function act(cmd: VoiceCommand | null) {
    setCommand(cmd);
    if (cmd === null) {
      setStage("idle");
      setMessage({ tone: "error", text: l.notUnderstood });
    } else if (cmd === "need_help") {
      setStage("idle");
      const button = document.querySelector<HTMLButtonElement>("[data-voice-help]");
      if (button) {
        button.scrollIntoView({ block: "center" });
        button.click();
        setMessage({ tone: "ok", text: l.helpOpened });
      } else setMessage({ tone: "ok", text: l.helpAlready });
    } else if (cmd === "took_medicine" && props.dosesNow.length === 0) {
      setStage("idle");
      setMessage({ tone: "error", text: l.noDoseNow });
    } else if (cmd !== "took_medicine" && !props.checkinUrl) {
      setStage("idle");
      setMessage({ tone: "error", text: l.notUnderstood });
    } else setStage("confirm");
  }

  async function confirm() {
    setStage("busy");
    let ok = true;
    if (command === "took_medicine") {
      for (const d of props.dosesNow) ok = (await callApi("POST", d.url, { status: "taken" })).ok && ok;
    } else if (props.checkinUrl) {
      const fine = command === "feel_fine";
      ok = (await callApi("POST", props.checkinUrl, { body: fine ? l.updateFine : l.updateUnwell, category: fine ? "general" : "health", important: !fine, checkin: fine ? "fine" : "unwell" })).ok;
    }
    setStage("idle");
    setMessage(ok ? { tone: "ok", text: l.recorded } : { tone: "error", text: l.generic });
    router.refresh();
  }

  const question =
    command === "took_medicine" ? l.confirmTook.replace("{list}", props.dosesNow.map((d) => d.name).join(", ")) : command === "feel_fine" ? l.confirmFine : l.confirmUnwell;

  if (!on) {
    return stage === "notice" ? (
      <div className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4">
        <p className="text-xl">{l.notice}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className={primary}
            onClick={() => {
              setOn(true);
              setStage("idle");
            }}
          >
            {l.turnOn}
          </button>
          <button type="button" className={secondary} onClick={() => setStage("idle")}>
            {l.notNow}
          </button>
        </div>
      </div>
    ) : (
      <button type="button" className={secondary} onClick={() => setStage("notice")}>
        <Mic aria-hidden="true" className="size-7 shrink-0" />
        {l.speak}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {stage === "confirm" || stage === "busy" ? (
        <div className="flex flex-col gap-3 rounded-2xl border-4 border-primary p-4">
          <p className="text-lg text-muted">{l.heard.replace("{text}", heard)}</p>
          <p className="text-2xl font-bold">{question}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className={primary} disabled={stage === "busy"} aria-busy={stage === "busy" || undefined} onClick={confirm}>
              {l.yes}
            </button>
            <button type="button" className={secondary} disabled={stage === "busy"} onClick={() => setStage("idle")}>
              {l.no}
            </button>
          </div>
        </div>
      ) : stage === "listening" ? (
        <button type="button" className={primary} onClick={() => rec.current?.abort()}>
          <Mic aria-hidden="true" className="size-7 shrink-0 animate-pulse" />
          {l.listening}
        </button>
      ) : (
        <>
          <button type="button" className={primary} onClick={listen}>
            <Mic aria-hidden="true" className="size-7 shrink-0" />
            {l.tapToSpeak}
          </button>
          <p className="text-lg text-muted">{l.examples}</p>
        </>
      )}
      {message && <p className={`text-xl font-semibold ${message.tone === "ok" ? "text-success" : "text-danger"}`}>{message.text}</p>}
      <button type="button" className={quiet} onClick={() => setOn(false)}>
        <MicOff aria-hidden="true" className="size-5" />
        {l.turnOff}
      </button>
    </div>
  );
}
