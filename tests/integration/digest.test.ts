import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications } from "@/server/db/schema";
import { markAllRead, updatePreferences } from "@/server/services/notifications";
import { postUpdate } from "@/server/services/updates";
import { sendDailyDigests } from "@/server/worker/digest";
import { runTick } from "@/server/worker/tick";
import { createTeam, createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { signUp } from "../helpers/users";

const db = setupTestDb();
const email = setupFakeEmail();

// Test users live in UTC, so their digest is due from 18:00 UTC.
const at = (time: string, day = "2026-11-14") => new Date(`${day}T${time}:00Z`);
const digestsTo = (address: string) => email().sent.filter((m) => m.to === address && m.subject.startsWith("CareNest: today's news"));

describe("daily digest of everyday news", () => {
  it("sends one evening email listing the day's updates by title, never their content", async () => {
    const team = await createTeam(db());
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "I'm fine today. Walked to the temple." });

    // Everyday updates are low-priority in-app news for everyone who can see updates, not the author.
    const inbox = await db().select().from(notifications).where(eq(notifications.kind, "care_update"));
    expect(new Set(inbox.map((n) => n.userId))).toEqual(new Set([team.admin.id, team.family.id, team.caregiver.id, team.clinician.id]));
    expect(inbox.every((n) => n.priority === "low")).toBe(true);

    await runTick(db(), at("17:59"));
    expect(digestsTo(team.family.email)).toEqual([]);

    await runTick(db(), at("18:05"));
    const [digest] = digestsTo(team.family.email);
    expect(digest.subject).toBe("CareNest: today's news (1)");
    expect(digest.text).toContain("Amma shared an update about Amma");
    expect(digest.text).not.toContain("temple");
    expect(digest.text).toContain("/app/notifications");
    expect(digestsTo(team.elder.email)).toEqual([]);

    // Later the same evening: nothing more.
    await postUpdate(team.as(team.elder, at("19:00")), team.circle.id, { body: "Dinner done." });
    await runTick(db(), at("20:00"));
    expect(digestsTo(team.family.email)).toHaveLength(1);

    // The next evening's digest covers only what came after the last one.
    await runTick(db(), at("18:01", "2026-11-15"));
    const all = digestsTo(team.family.email);
    expect(all).toHaveLength(2);
    expect(all[1].subject).toBe("CareNest: today's news (1)");
  });

  it("leaves out what the person already read in the app, and sends nothing if that's everything", async () => {
    const team = await createTeam(db());
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "All good." });
    await markAllRead(team.as(team.family, at("12:00")));
    await runTick(db(), at("18:05"));
    expect(digestsTo(team.family.email)).toEqual([]);
    expect(digestsTo(team.admin.email)).toHaveLength(1);
  });

  it("respects turning off the digest, or email altogether", async () => {
    const team = await createTeam(db());
    await updatePreferences(team.as(team.family, at("08:00")), { emailEnabled: true, quietStart: null, quietEnd: null, digestEnabled: false });
    await updatePreferences(team.as(team.caregiver, at("08:00")), { emailEnabled: false, quietStart: null, quietEnd: null });
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "All good." });
    await runTick(db(), at("18:05"));
    expect(digestsTo(team.family.email)).toEqual([]);
    expect(digestsTo(team.caregiver.email)).toEqual([]);
    expect(digestsTo(team.admin.email)).toHaveLength(1);
  });

  it("never includes news from a circle the person isn't in", async () => {
    const team = await createTeam(db());
    const outsider = await signUp({ name: "Eve" });
    await createTestCircle(outsider, { name: "Eve's dad" });
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "All good." });
    await runTick(db(), at("18:05"));
    expect(digestsTo(outsider.email)).toEqual([]);
  });

  it("sends only one digest even if two workers run at the same moment", async () => {
    const team = await createTeam(db());
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "All good." });
    const [a, b] = await Promise.all([sendDailyDigests(db(), at("18:05")), sendDailyDigests(db(), at("18:05"))]);
    expect(a + b).toBe(4); // admin, family, caregiver, clinician — once each
    await runTick(db(), at("18:06"));
    expect(digestsTo(team.family.email)).toHaveLength(1);
  });

  it("still emails important updates straight away, and keeps them out of the digest", async () => {
    const team = await createTeam(db());
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "I'm not feeling well.", important: true });
    await runTick(db(), at("09:01"));
    expect(email().sent.some((m) => m.to === team.family.email && !m.subject.startsWith("CareNest: today's news"))).toBe(true);
    await runTick(db(), at("18:05"));
    expect(digestsTo(team.family.email)).toEqual([]);
  });
});
