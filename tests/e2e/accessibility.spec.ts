import { expect, test } from "@playwright/test";
import { Actor, circleWith } from "../blackbox/client";
import { expectAccessible, localSlot, pageAs } from "./helpers";

// Every main screen, with realistic content on it, scanned for WCAG 2.1 A/AA problems.
let owner: Actor;
let elder: Actor;
let circleId: string;

test.beforeAll(async () => {
  owner = await new Actor("Priya").register();
  elder = await new Actor("Amma").register("Asia/Kolkata");
  const caregiver = await new Actor("Meena").register("Asia/Kolkata");
  circleId = await circleWith(owner, [[elder, "care_recipient"], [caregiver, "caregiver"]]);
  const slot = localSlot(30, "Asia/Kolkata");
  await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: [slot.time], startDate: slot.date, supplyCount: 3, refillThreshold: 5 });
  await owner.post(`/api/v1/circles/${circleId}/appointments`, { title: "Eye clinic", startsAt: new Date(Date.now() + 26 * 3_600_000).toISOString() });
  await owner.post(`/api/v1/circles/${circleId}/tasks`, { title: "Buy groceries" });
  await owner.post(`/api/v1/circles/${circleId}/updates`, { body: "Amma had a good walk this morning." });
  // Two readings, so the Health page shows a chart.
  await caregiver.post(`/api/v1/circles/${circleId}/measurements`, { kind: "blood_pressure", unit: "mmHg", value: 132, value2: 84, measuredAt: new Date(Date.now() - 86_400_000).toISOString() });
  await caregiver.post(`/api/v1/circles/${circleId}/measurements`, { kind: "blood_pressure", unit: "mmHg", value: 128, value2: 80 });
});

test("signed-out pages", async ({ browser }) => {
  const page = await pageAs(browser, null);
  for (const path of ["/", "/login", "/register"]) {
    await page.goto(path);
    await expectAccessible(page);
  }
});

const circlePages = ["", "/medicines", "/health", "/documents", "/appointments", "/tasks", "/visits", "/updates", "/messages", "/timeline", "/members", "/settings", "/emergency", "/activity", "/reports"];

test("the full app, as a family admin", async ({ browser }) => {
  test.slow(); // scans every page of the app
  const page = await pageAs(browser, owner);
  for (const path of ["/app", "/app/notifications", "/app/account", "/app/circles/new", ...circlePages.map((p) => `/app/circles/${circleId}${p}`)]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expectAccessible(page);
  }
});

// The dark theme has its own colours; their contrast is checked separately, not assumed.
test("the main screens in dark mode", async ({ browser }) => {
  const page = await pageAs(browser, owner, { colorScheme: "dark" });
  for (const path of ["/app", "/app/notifications", ...["", "/medicines", "/health", "/tasks", "/timeline", "/settings", "/reports"].map((p) => `/app/circles/${circleId}${p}`)]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expectAccessible(page);
  }
  const parent = await pageAs(browser, elder, { colorScheme: "dark" });
  await parent.goto(`/simple/${circleId}`);
  await expectAccessible(parent);
  const visitor = await pageAs(browser, null, { colorScheme: "dark" });
  await visitor.goto("/");
  await expectAccessible(visitor);
});

test("the Simple view, as the parent @phone", async ({ browser }) => {
  const page = await pageAs(browser, elder);
  await page.goto(`/simple/${circleId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Amma");
  await expectAccessible(page);
  // The two-step questions open more controls; those must be accessible too.
  await page.getByRole("button", { name: "No, I didn't" }).click();
  await page.getByRole("button", { name: "I'm not feeling well" }).click();
  await page.getByRole("button", { name: "I need help" }).click();
  await expectAccessible(page);
});

test("keyboard users can skip straight to the content", async ({ browser }) => {
  for (const [actor, path] of [
    [owner, "/app"],
    [null, "/login"],
    [elder, `/simple/${circleId}`],
  ] as const) {
    const page = await pageAs(browser, actor);
    await page.goto(path, { waitUntil: "networkidle" });
    // React reveals streamed sections in short batches; wait until the header is really shown.
    await page.waitForFunction(() => {
      const link = document.querySelector('a[href="#main"]');
      return link !== null && link.closest("[hidden]") === null;
    });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" }), path).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  }
});
