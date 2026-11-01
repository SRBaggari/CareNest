import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Actor, circleWith } from "../blackbox/client";
import { pageAs } from "./helpers";

// The test server "sends" texts by writing them to this file (no real SMS provider is wired yet).
const texts = (): { to: string; body: string }[] => {
  try {
    return readFileSync(".data/e2e-sms.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

test("a family member adds their number, confirms it with the texted code, and gets a text when the parent asks for help @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const elder = await new Actor("Amma").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
  // A number unique to this run, so parallel runs (desktop and phone) don't read each other's texts.
  const phone = `+9198${String(Date.now()).slice(-8)}`;

  const page = await pageAs(browser, owner);
  await page.goto("/app/account");
  const section = page.getByRole("region", { name: "Text messages (SMS)" });
  await section.getByLabel("Mobile number").fill(phone);
  await section.getByRole("button", { name: "Send code" }).click();
  await expect(section.getByText(/We sent a 6-digit code to \+91 ••••• •/)).toBeVisible();
  const code = /\b(\d{6})\b/.exec(texts().filter((t) => t.to === phone).at(-1)?.body ?? "")?.[1];
  expect(code).toBeTruthy();
  await section.getByLabel("Code").fill(code!);
  await section.getByRole("button", { name: "Confirm number" }).click();
  await expect(section.getByText(/Texts go to \+91 ••••• •/)).toBeVisible();
  await expect(section.getByLabel("Only when someone asks for help")).toBeChecked();

  // The parent asks for help: the text arrives (sent straight away, not on the worker's next tick).
  expect((await elder.post(`/api/v1/circles/${circleId}/emergency/requests`, {})).status).toBe(201);
  await expect.poll(() => texts().filter((t) => t.to === phone && t.body.includes("asked for help")).length).toBe(1);
});
