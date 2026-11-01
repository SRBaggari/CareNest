import { expect, test } from "@playwright/test";
import { Actor, circleWith } from "../blackbox/client";
import { expectAccessible, localSlot, pageAs } from "./helpers";

// The test server uses a stand-in model (ASSISTANT_MODEL=test): no AI, no records leave the machine.
test("once turned on, the family asks a question and gets an answer that links to the records it used @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const elder = await new Actor("Amma").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
  const slot = localSlot(30, "Asia/Kolkata");
  await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: [slot.time], startDate: slot.date });

  const page = await pageAs(browser, owner);
  // Off by default: no "Ask" in the menu, and the page says how to turn it on.
  await page.goto(`/app/circles/${circleId}`);
  await expect(page.getByRole("link", { name: "Ask", exact: true })).toHaveCount(0);
  await page.goto(`/app/circles/${circleId}/assistant`);
  await expect(page.getByText(/Ask CareNest is off for this circle/)).toBeVisible();

  // The parent manages their own sharing choices, so they turn it on (the admin can't).
  await page.goto(`/app/circles/${circleId}/settings`);
  await expect(page.getByLabel(/Let the AI assistant answer/)).toHaveCount(0);
  const parent = await pageAs(browser, elder);
  await parent.goto(`/app/circles/${circleId}/settings`);
  await parent.getByLabel(/Let the AI assistant answer/).check();
  await parent.getByLabel(/Let the AI assistant answer/).locator("xpath=ancestor::form").getByRole("button").click();
  await expect(parent.getByText("Saved.").first()).toBeVisible();

  await page.goto(`/app/circles/${circleId}`);
  await page.getByRole("link", { name: "Ask", exact: true }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/assistant$/);
  await page.getByLabel("Your question").fill("Which medicines does she take?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText(/Test answer from \d+ records: Metformin 500 mg/)).toBeVisible();
  await expect(page.getByText("AI answers can be wrong. Check the linked records before acting on them.")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("link", { name: "Metformin" }).click();
  await expect(page).toHaveURL(/\/medicines$/);

  // Medical questions get the fixed safety answer, never the model's words.
  await page.goto(`/app/circles/${circleId}/assistant`);
  await page.getByLabel("Your question").fill("Should she take an extra dose?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText(/CareNest can't answer medical questions\. Please ask a doctor or pharmacist\./)).toBeVisible();
});
