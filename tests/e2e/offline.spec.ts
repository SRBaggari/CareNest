import { expect, test } from "@playwright/test";
import { Actor, circleWith } from "../blackbox/client";
import { localSlot, pageAs } from "./helpers";

// Saved pages (the build files the app loads are public and may be kept again at once).
const savedPages = () =>
  caches
    .open("carenest-offline-v1")
    .then((c) => c.keys())
    .then((keys) => keys.map((r) => new URL(r.url).pathname).filter((p) => !p.startsWith("/_next/")));

test("the parent can read today's plan and the family the emergency card without a connection, and sign-out wipes it", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const elder = await new Actor("Amma").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
  const slot = localSlot(30, "Asia/Kolkata");
  await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: [slot.time], startDate: slot.date });

  // The parent opens their Simple view once while online; that's enough to keep it.
  const parent = await pageAs(browser, elder);
  await parent.goto(`/simple/${circleId}`);
  await expect(parent.getByText("Metformin").first()).toBeVisible();
  await parent.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => parent.evaluate(() => caches.open("carenest-offline-v1").then((c) => c.keys()).then((k) => k.some((r) => r.url.includes("/simple/"))))).toBe(true);

  await parent.context().setOffline(true);
  await parent.reload();
  await expect(parent.getByText("Metformin").first()).toBeVisible();
  await expect(parent.getByRole("status").filter({ hasText: /You're offline/ })).toBeVisible();
  // Pages that aren't kept are simply unavailable offline.
  await expect(parent.goto(`/app/circles/${circleId}/medicines`)).rejects.toThrow();
  await parent.context().setOffline(false);

  // A family member keeps the emergency page: the number to call and the contacts.
  const family = await pageAs(browser, owner);
  await family.goto(`/app/circles/${circleId}/emergency`);
  await family.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => family.evaluate(() => caches.open("carenest-offline-v1").then((c) => c.keys()).then((k) => k.some((r) => r.url.endsWith("/emergency"))))).toBe(true);
  await family.context().setOffline(true);
  await family.reload();
  await expect(family.getByRole("link", { name: /^Call / }).first()).toBeVisible();
  await family.context().setOffline(false);

  // Signing out deletes every saved page on that device.
  await family.goto("/app/account");
  await family.getByRole("button", { name: "Sign out" }).filter({ visible: true }).first().click();
  await expect(family).toHaveURL(/\/login/);
  expect(await family.evaluate(savedPages)).toEqual([]);
});
