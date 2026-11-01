import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Actor, circleWith } from "../blackbox/client";
import { localSlot, pageAs } from "./helpers";

// The main scenarios, clicked through in a real browser. Setup that isn't the point of a test
// goes through the API; everything the test is about is done on screen.

test("Scenario A: sign up, create a circle and invite a sibling, who joins @phone", async ({ browser }) => {
  const page = await pageAs(browser, null);
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Priya");
  await page.getByLabel("Email address").fill(`e2e-${randomUUID()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Priya" })).toBeVisible();

  await page.getByRole("link", { name: "Create a care circle" }).click();
  await page.getByLabel("Circle name").fill("Amma's care");
  await page.getByLabel("Their full name").fill("Lakshmi Rao");
  await page.getByRole("button", { name: "Create circle" }).click();
  await expect(page.getByRole("heading", { name: "Amma's care", level: 1 })).toBeVisible();

  const ravi = await new Actor("Ravi").register();
  // Desktop: "Members" in the sidebar. Phone: the "Circle" section in the bottom bar opens Members.
  await page.getByRole("link", { name: /^(Members|Circle)$/ }).filter({ visible: true }).first().click();
  await page.getByLabel("Their email address").fill(ravi.email);
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = (await page.getByText(/\/invite\//).textContent())!.trim();

  const sibling = await pageAs(browser, ravi);
  await sibling.goto(link);
  await sibling.getByRole("button", { name: "Join this circle" }).click();
  await expect(sibling.getByRole("heading", { name: "Amma's care", level: 1 })).toBeVisible();
});

test("Scenario B: the parent confirms a dose on the Simple view and the family sees it @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const elder = await new Actor("Amma").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[elder, "care_recipient"]]);
  const slot = localSlot(30, "Asia/Kolkata");
  await owner.post(`/api/v1/circles/${circleId}/medications`, { name: "Metformin", dosage: "500 mg", times: [slot.time], startDate: slot.date });

  const parent = await pageAs(browser, elder);
  await parent.goto("/app");
  await expect(parent).toHaveURL(new RegExp(`/simple/${circleId}$`));
  await parent.getByRole("button", { name: "Yes, I took it" }).click();
  await expect(parent.getByText(/Saved as taken/)).toBeVisible();
  await expect(parent.getByText("Done today")).toBeVisible();

  const family = await pageAs(browser, owner);
  await family.goto(`/app/circles/${circleId}`);
  const tally = family.getByRole("region", { name: "Medicines today" });
  await expect(tally.getByText("Taken")).toBeVisible();
  await expect(family.getByText(/Last recorded: a medicine by Amma/)).toBeVisible();
});

test("Scenario C: a caregiver checks in and out on their phone; the family sees the visit and the handover @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const caregiver = await new Actor("Meena").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[caregiver, "caregiver"]]);
  const plannedStart = new Date(Date.now() + 10 * 60_000).toISOString();
  expect((await caregiver.post(`/api/v1/circles/${circleId}/visits`, { plannedStart, purpose: "Morning care" })).status).toBe(201);

  const phone = await pageAs(browser, caregiver);
  await phone.goto(`/app/circles/${circleId}/visits`);
  await phone.getByRole("button", { name: "I've arrived" }).click();
  await expect(phone.getByRole("button", { name: "Finish visit" })).toBeVisible();

  const family = await pageAs(browser, owner);
  await family.goto(`/app/circles/${circleId}`);
  await expect(family.getByRole("region", { name: "Visits today" }).getByText("Meena is there now")).toBeVisible();

  await phone.getByRole("button", { name: "Finish visit" }).click();
  await phone.getByLabel("How was Amma? What did you do?").fill("Bathed and had breakfast. Cheerful.");
  await phone.getByLabel("Note for whoever comes next (optional)").fill("Evening tablets are in the blue box.");
  await phone.getByRole("button", { name: "Finish visit" }).click();
  await expect(phone.getByText("Finished").first()).toBeVisible();

  await family.reload();
  const visits = family.getByRole("region", { name: "Visits today" });
  await expect(visits.getByText("Latest handover note from Meena")).toBeVisible();
  await expect(visits.getByText("Evening tablets are in the blue box.")).toBeVisible();
  await family.goto("/app/notifications");
  await expect(family.getByText("Meena finished a visit with Amma")).toBeVisible();
});

test("a caregiver records blood pressure; the family sees the latest reading and a chart @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const caregiver = await new Actor("Meena").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[caregiver, "caregiver"]]);
  await caregiver.post(`/api/v1/circles/${circleId}/measurements`, { kind: "blood_pressure", unit: "mmHg", value: 140, value2: 90, measuredAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });

  const phone = await pageAs(browser, caregiver);
  await phone.goto(`/app/circles/${circleId}/health`);
  await phone.getByLabel("Upper number (systolic)").fill("128");
  await phone.getByLabel("Lower number (diastolic)").fill("82");
  await phone.getByRole("button", { name: "Save reading" }).click();
  await expect(phone.getByText("Reading saved.")).toBeVisible();

  const family = await pageAs(browser, owner);
  await family.goto(`/app/circles/${circleId}/health`);
  const card = family.getByRole("region", { name: "Blood pressure" });
  await expect(card.getByText("128/82 mmHg").first()).toBeVisible();
  await expect(card.getByRole("img", { name: "Blood pressure over the last 90 days" })).toBeVisible();
  // CareNest never labels a reading; it says to contact a doctor if worried.
  await expect(family.getByText(/doesn't judge readings/)).toBeVisible();
});

test("a caregiver photographs a prescription; the family opens it and the document shows who looked @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const caregiver = await new Actor("Meena").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[caregiver, "caregiver"]]);

  const phone = await pageAs(browser, caregiver);
  await phone.goto(`/app/circles/${circleId}/documents`);
  await phone.getByLabel("File (a PDF or a photo, up to 10 MB)").setInputFiles({ name: "prescription.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 %%EOF") });
  await phone.getByLabel("Name", { exact: true }).fill("Dr Rao's prescription");
  await phone.getByLabel("Type").selectOption("prescription");
  await phone.getByRole("button", { name: "Upload" }).click();
  await expect(phone.getByText("Document added.")).toBeVisible();

  const family = await pageAs(browser, owner);
  await family.goto(`/app/circles/${circleId}/documents`);
  await expect(family.getByRole("heading", { name: "Dr Rao's prescription" })).toBeVisible();
  const opened = await family.request.get(await family.getByRole("link", { name: "Open" }).getAttribute("href") as string);
  expect(opened.headers()["content-type"]).toBe("application/pdf");
  await family.reload();
  await family.getByText(/Versions and who opened it/).click();
  await expect(family.getByText(/Priya opened it/)).toBeVisible();
});

test("family asks the caregiver something; she sees it as new and replies @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const caregiver = await new Actor("Meena").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[caregiver, "caregiver"]]);

  const family = await pageAs(browser, owner);
  await family.goto(`/app/circles/${circleId}/messages`);
  await family.getByLabel("Subject").fill("Pharmacy run");
  await family.getByLabel("Message", { exact: true }).fill("Can you pick up the BP tablets tomorrow?");
  await family.getByRole("checkbox", { name: "Meena" }).check();
  await family.getByRole("button", { name: "Start a conversation" }).click();
  await expect(family.getByRole("heading", { name: "Pharmacy run" })).toBeVisible();

  const phone = await pageAs(browser, caregiver);
  await phone.goto(`/app/circles/${circleId}/messages`);
  await expect(phone.getByText("New: 1")).toBeVisible();
  await phone.getByRole("link", { name: /Pharmacy run/ }).click();
  await expect(phone.getByText("Can you pick up the BP tablets tomorrow?")).toBeVisible();
  await phone.getByLabel("Reply").fill("Yes, after my morning visit.");
  await phone.getByRole("button", { name: "Send" }).click();
  await expect(phone.getByText("Yes, after my morning visit.")).toBeVisible();

  await family.reload();
  await expect(family.getByText("Yes, after my morning visit.")).toBeVisible();
});

test("Scenario D: a missing driver shows on the dashboard until someone offers", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const circleId = await circleWith(owner);
  await owner.post(`/api/v1/circles/${circleId}/appointments`, { title: "Cardiology check-up", startsAt: new Date(Date.now() + 26 * 3_600_000).toISOString() });

  const page = await pageAs(browser, owner);
  await page.goto(`/app/circles/${circleId}`);
  await page.getByRole("link", { name: /No driver yet for Cardiology check-up/ }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  await page.getByRole("button", { name: "I'll drive" }).click();
  await expect(page.getByText("Driving: Priya")).toBeVisible();

  await page.getByRole("link", { name: "Today" }).filter({ visible: true }).first().click();
  await expect(page.getByText(/No driver yet/)).toHaveCount(0);
  await expect(page.getByText("Driver: Priya")).toBeVisible();
});

test("Scenario E: the parent asks for help; the family sees it first and responds @phone", async ({ browser }) => {
  const owner = await new Actor("Priya").register();
  const elder = await new Actor("Amma").register("Asia/Kolkata");
  const circleId = await circleWith(owner, [[elder, "care_recipient"]]);

  const parent = await pageAs(browser, elder);
  await parent.goto(`/simple/${circleId}`);
  await parent.getByRole("button", { name: "I need help" }).click();
  await parent.getByLabel("What's happening? (optional)").fill("I feel dizzy");
  await parent.getByRole("button", { name: "Yes, alert my family" }).click();
  await expect(parent).toHaveURL(/\/emergency\/[\w-]+$/);

  const family = await pageAs(browser, owner);
  await family.goto("/app");
  await expect(family.getByText("Help has been requested")).toBeVisible();
  await family.goto(`/app/circles/${circleId}`);
  await family.getByRole("link", { name: /Help was requested at/ }).click();
  await expect(family.getByText("I feel dizzy")).toBeVisible();
  await family.getByRole("button", { name: "I'm responding" }).click();
  await expect(family.getByText(/Priya is responding/)).toBeVisible();
  // CareNest never claims to have called emergency services.
  await expect(family.getByText(/not an emergency service/i).first()).toBeVisible();
});

test("Scenario F: one person, two parents, each circle shown separately", async ({ browser }) => {
  const priya = await new Actor("Priya").register();
  const amma = await circleWith(priya);
  const created = await priya.post("/api/v1/circles", {
    name: "Nanna's care",
    recipient: { displayName: "Ramesh Rao", preferredName: "Nanna", timeZone: "Asia/Kolkata", country: "IN" },
  });
  await priya.post(`/api/v1/circles/${created.json.circle.id}/tasks`, { title: "Book a plumber" });

  const page = await pageAs(browser, priya);
  await page.goto("/app");
  const cards = page.getByRole("list").filter({ has: page.getByRole("link", { name: /care/ }) });
  await expect(cards.getByRole("link", { name: /Amma's care/ })).toContainText("Nothing needs attention");
  await expect(cards.getByRole("link", { name: /Nanna's care/ })).toContainText("Needs attention: 1");
  await page.getByRole("link", { name: /Amma's care/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/circles/${amma}$`));
  await expect(page.getByText("Book a plumber")).toHaveCount(0);
});
