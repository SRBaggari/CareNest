import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { careProfiles, doseEvents } from "@/server/db/schema";
import { archiveCircle } from "@/server/services/circles";
import { createMedication, stopMedication, updateMedication } from "@/server/services/medications";
import { prepareDoses } from "@/server/worker/tick";
import { createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { signUp } from "../helpers/users";

const db = setupTestDb();
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const METFORMIN = { name: "Metformin", dosage: "500 mg", startDate: "2026-11-14", asNeeded: false, times: ["08:00"], unitsPerDose: 1 } as const;

async function circleWithMedicine(time = "08:00") {
  const admin = await signUp();
  const circle = await createTestCircle(admin);
  const as = (now: Date) => ({ db: db(), now, userId: admin.id });
  const med = await createMedication(as(ist("2026-11-13", "20:00")), circle.id, { ...METFORMIN, times: [time] });
  return { admin, circle, as, med };
}

const dosesOf = (circleId: string) => db().select().from(doseEvents).where(eq(doseEvents.circleId, circleId));

describe("dose preparation scales with circles, not with ticks", () => {
  it("does the work once per local day, and again only when a medicine changes", async () => {
    const { circle, as, med } = await circleWithMedicine();
    expect(await prepareDoses(db(), ist("2026-11-14", "06:00"))).toBe(1);
    expect(await dosesOf(circle.id)).toHaveLength(2); // today and tomorrow
    expect(await prepareDoses(db(), ist("2026-11-14", "06:01"))).toBe(0);
    expect(await prepareDoses(db(), ist("2026-11-14", "15:00"))).toBe(0);

    // Editing the schedule bumps the version: tonight's tick picks up the new time.
    await updateMedication(as(ist("2026-11-14", "16:00")), circle.id, med.id, { version: med.version, times: ["08:00", "20:00"] });
    expect(await prepareDoses(db(), ist("2026-11-14", "16:01"))).toBe(1);
    expect((await dosesOf(circle.id)).map((d) => d.localTime).sort()).toEqual(["08:00", "08:00", "20:00", "20:00"]);

    // A new local day (in the recipient's zone) extends the window.
    expect(await prepareDoses(db(), ist("2026-11-15", "00:01"))).toBe(1);
    expect((await dosesOf(circle.id)).filter((d) => d.localDate === "2026-11-16")).toHaveLength(2);
  });

  it("picks up a newly added medicine on the next tick, so its reminders aren't missed", async () => {
    const { circle, as } = await circleWithMedicine();
    await prepareDoses(db(), ist("2026-11-14", "06:00"));
    await createMedication(as(ist("2026-11-14", "06:30")), circle.id, { ...METFORMIN, name: "Amlodipine", times: ["09:00"] });
    expect(await prepareDoses(db(), ist("2026-11-14", "06:31"))).toBe(1);
    expect((await dosesOf(circle.id)).some((d) => d.localDate === "2026-11-14" && d.localTime === "09:00")).toBe(true);
  });

  it("notices a stopped medicine, and skips circles with no scheduled medicines at all", async () => {
    const { circle, as, med } = await circleWithMedicine();
    await prepareDoses(db(), ist("2026-11-14", "06:00"));
    await stopMedication(as(ist("2026-11-14", "07:00")), circle.id, med.id, { reason: "Doctor stopped it" });
    expect(await prepareDoses(db(), ist("2026-11-14", "07:01"))).toBe(1);

    const empty = await createTestCircle(await signUp());
    expect(await prepareDoses(db(), ist("2026-11-14", "07:02"))).toBe(0);
    expect(await dosesOf(empty.id)).toEqual([]);
  });

  it("marks overdue doses unconfirmed using each circle's own grace period, in one pass", async () => {
    const strict = await circleWithMedicine();
    const relaxed = await circleWithMedicine();
    await db().update(careProfiles).set({ doseGraceMinutes: 30 }).where(eq(careProfiles.circleId, strict.circle.id));
    await prepareDoses(db(), ist("2026-11-14", "07:00"));

    await prepareDoses(db(), ist("2026-11-14", "08:45"));
    const status = async (circleId: string) =>
      (await db().select().from(doseEvents).where(and(eq(doseEvents.circleId, circleId), eq(doseEvents.localDate, "2026-11-14"))))[0].status;
    expect(await status(strict.circle.id)).toBe("unconfirmed");
    expect(await status(relaxed.circle.id)).toBe("scheduled");
    await prepareDoses(db(), ist("2026-11-14", "09:01"));
    expect(await status(relaxed.circle.id)).toBe("unconfirmed");
  });

  it("leaves archived circles alone", async () => {
    const { admin, circle } = await circleWithMedicine();
    await prepareDoses(db(), ist("2026-11-14", "07:00"));
    await archiveCircle({ db: db(), now: ist("2026-11-14", "07:30"), userId: admin.id }, circle.id);
    await prepareDoses(db(), ist("2026-11-14", "12:00"));
    const [today] = (await dosesOf(circle.id)).filter((d) => d.localDate === "2026-11-14");
    expect(today.status).toBe("scheduled");
  });
});
