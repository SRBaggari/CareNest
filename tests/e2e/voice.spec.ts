import { expect, test, type Page } from "@playwright/test";
import { Actor, circleWith } from "../blackbox/client";
import { expectAccessible, localSlot, pageAs } from "./helpers";

// Browsers in CI have no voices or microphone, so speech is replaced with fakes before the page
// loads: what is "said" is set per test, and everything "spoken" is collected.
async function withFakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__spoken = [] as string[];
    w.__transcript = "";
    w.SpeechSynthesisUtterance = class {
      text: string;
      onend: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{ name: "Test voice", lang: "en-IN" }],
        speak: (u: { text: string; onend: (() => void) | null }) => {
          (w.__spoken as string[]).push(u.text);
          setTimeout(() => u.onend?.(), 0);
        },
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    w.SpeechRecognition = class {
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: w.__transcript as string }]] });
          this.onend?.();
        }, 50);
      }
      abort() {
        this.onend?.();
      }
    };
  });
}

const say = (page: Page, words: string) => page.evaluate((t) => ((window as unknown as Record<string, unknown>).__transcript = t), words);

test("the parent hears their day read aloud, and records a dose by speaking @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const elder = await new Actor("Amma").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
  const slot = localSlot(30, "Asia/Kolkata");
  await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: [slot.time], startDate: slot.date });

  const parent = await pageAs(browser, elder);
  await withFakeSpeech(parent);
  await parent.goto(`/simple/${circleId}`);

  await parent.getByRole("button", { name: "Read my day aloud" }).click();
  await expect.poll(() => parent.evaluate(() => ((window as unknown as Record<string, string[]>).__spoken ?? []).join(" "))).toContain("Medicines to take now: Metformin, 500 mg.");

  // Off until turned on, with a plain notice about where the voice goes.
  await parent.getByRole("button", { name: "Speak instead of tapping" }).click();
  await expect(parent.getByText(/your browser may send your voice/)).toBeVisible();
  await expectAccessible(parent);
  await parent.getByRole("button", { name: "Turn on speaking" }).click();

  // Something that isn't a command records nothing.
  await say(parent, "I didn't take my medicine");
  await parent.getByRole("button", { name: "Tap and speak" }).click();
  await expect(parent.getByText("Sorry, I didn't understand. Please try again, or use the buttons.")).toBeVisible();

  await say(parent, "I took my medicine");
  await parent.getByRole("button", { name: "Tap and speak" }).click();
  await expect(parent.getByText("Record Metformin as taken?")).toBeVisible();
  await expectAccessible(parent);
  await parent.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(parent.getByText("Done. Your family can see it.")).toBeVisible();
  await expect(parent.getByText("Done today")).toBeVisible();
  const { doses } = (await owner.get(`/api/v1/circles/${circleId}/doses`)).json;
  expect(doses[0].status).toBe("taken");

  // "I need help" opens the same confirmation as the red button; nothing is sent until confirmed.
  await say(parent, "I need help");
  await parent.getByRole("button", { name: "Tap and speak" }).click();
  await expect(parent.getByText("Alert your family now?")).toBeVisible();
  expect((await owner.get(`/api/v1/circles/${circleId}/emergency/requests`)).json.requests).toEqual([]);

  // The choice is remembered on this device, and can be turned off.
  await parent.reload();
  await expect(parent.getByRole("button", { name: "Tap and speak" })).toBeVisible();
  await parent.getByRole("button", { name: "Turn off speaking" }).click();
  await expect(parent.getByRole("button", { name: "Speak instead of tapping" })).toBeVisible();
});

test("without speech support, the Simple view shows no voice controls at all", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const elder = await new Actor("Amma").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
  const parent = await pageAs(browser, elder);
  await parent.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
  await parent.goto(`/simple/${circleId}`);
  await expect(parent.getByRole("heading", { level: 1 })).toContainText("Amma");
  await expect(parent.getByRole("button", { name: /Read my day aloud|Speak instead of tapping/ })).toHaveCount(0);
});
