import { expect, test } from "@playwright/test";
import { Actor, circleWith } from "../blackbox/client";
import { expectAccessible, pageAs } from "./helpers";

test("the parent changes language from beside Sign out, and back again @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const elder = await new Actor("Amma").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
  expect((await elder.patch("/api/v1/me", { locale: "te" })).status).toBe(200);

  const page = await pageAs(browser, elder);
  await page.goto(`/simple/${circleId}`);
  await expect(page.getByRole("button", { name: "నాకు సహాయం కావాలి" })).toBeVisible();

  // The button shows the current language in its own script, next to Sign out.
  const menu = page.getByRole("button", { name: /భాష మార్చండి: తెలుగు/ });
  await expect(menu).toBeVisible();
  await menu.click();
  await expectAccessible(page);
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "I need help" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  // And back, from the English screen.
  await page.getByRole("button", { name: /Change language: English/ }).click();
  await page.getByRole("button", { name: "తెలుగు" }).click();
  await expect(page.getByRole("button", { name: "నాకు సహాయం కావాలి" })).toBeVisible();
  // The choice is saved on the account, so it holds on reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "నాకు సహాయం కావాలి" })).toBeVisible();
});

test("family members change language from the header (or the Account page on a phone) @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const page = await pageAs(browser, owner);
  await page.goto("/app/account");
  await page.getByRole("button", { name: /Change language: English/ }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: "हिन्दी" }).click();
  await expect(page.getByRole("button", { name: "साइन आउट करें" }).filter({ visible: true }).first()).toBeVisible();
  // Escape closes the list without changing anything.
  await page.getByRole("button", { name: /भाषा बदलें: हिन्दी/ }).filter({ visible: true }).first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "English" })).toHaveCount(0);
});
