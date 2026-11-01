import AxeBuilder from "@axe-core/playwright";
import { expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { Actor, BASE } from "../blackbox/client";

/** A browser tab signed in as an actor created through the API (same session cookie, same client address). */
export async function pageAs(browser: Browser, actor: Actor | null, options: BrowserContextOptions = {}): Promise<Page> {
  const ip = actor?.ip ?? new Actor().ip;
  const context = await browser.newContext({ ...options, extraHTTPHeaders: { "x-forwarded-for": ip } });
  if (actor?.cookie) {
    const [name, ...value] = actor.cookie.split("=");
    await context.addCookies([{ name, value: value.join("="), url: BASE }]);
  }
  return context.newPage();
}

/** No WCAG 2.1 A/AA violations that axe can detect on the current page. */
export async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `axe violations on ${page.url()}`).toEqual([]);
}

/** "HH:mm" a given number of minutes from now in a time zone, and that zone's date. */
export function localSlot(minutesFromNow: number, timeZone: string) {
  const at = new Date(Date.now() + minutesFromNow * 60_000);
  return {
    time: at.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }),
    date: at.toLocaleDateString("en-CA", { timeZone }),
  };
}
