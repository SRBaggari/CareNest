import { expect, test } from "@playwright/test";
import { Actor, circleWith } from "../blackbox/client";
import { localSlot, pageAs } from "./helpers";

// Telugu and Tamil words are much longer than English ones; at phone width nothing may push the
// page wider than the screen (sideways scrolling is hard for everyone, and worst for older users).
for (const locale of ["en", "hi", "te", "ta"]) {
  test(`no page scrolls sideways on a phone in ${locale} @phone`, async ({ browser }) => {
    test.slow(); // walks every page of the app; under a parallel run that can take past 30s
    const owner = await new Actor("Priya").register();
    expect((await owner.patch("/api/v1/me", { locale })).status).toBe(200);
    const elder = await new Actor("Amma").register("Asia/Kolkata");
    const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
    const slot = localSlot(30, "Asia/Kolkata");
    await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: [slot.time], startDate: slot.date, supplyCount: 3, refillThreshold: 5 });
    await owner.post(`/api/v1/circles/${circleId}/appointments`, { title: "Cardiology check-up", startsAt: new Date(Date.now() + 26 * 3_600_000).toISOString() });
    await owner.post(`/api/v1/circles/${circleId}/tasks`, { title: "Collect the new prescription" });

    const page = await pageAs(browser, owner, { viewport: { width: 360, height: 800 } });
    const base = `/app/circles/${circleId}`;
    const paths = ["/app", "/app/notifications", "/app/account", base, ...["medicines", "health", "documents", "appointments", "tasks", "visits", "updates", "messages", "timeline", "members", "settings", "emergency", "activity"].map((p) => `${base}/${p}`)];
    const wide: string[] = [];
    for (const path of paths) {
      // Measure the settled page: before the web font loads, text briefly lays out in a fallback font.
      await page.goto(path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const { scroll, width, culprits } = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        // The outermost elements that poke past the right edge (ignoring rows meant to scroll), to say what to fix.
        const past = (el: Element | null) => !!el && el.getBoundingClientRect().right > width + 1;
        const culprits = [...document.querySelectorAll("body *")]
          .filter((el) => past(el) && !past(el.parentElement) && !el.closest(".overflow-x-auto"))
          .slice(0, 3)
          .map((el) => `<${el.tagName.toLowerCase()} class="${String(el.getAttribute("class")).slice(0, 60)}"> "${(el.textContent ?? "").trim().slice(0, 40)}"`);
        // Elements whose content spills past their own box (often a long word in a flex label).
        const spilling = [...document.querySelectorAll("main *")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible")
          .slice(-2)
          .map((el) => `spills: <${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 40)}"`);
        return { scroll: document.documentElement.scrollWidth, width, culprits: [...culprits, ...spilling] };
      });
      if (scroll > width) wide.push(`${path.replace(circleId, ":id")} (${scroll}px): ${culprits.join(", ")}`);
    }
    expect(wide).toEqual([]);
  });
}
