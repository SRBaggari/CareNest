import { describe, expect, it } from "vitest";
import { GET as csvRoute } from "@/app/api/v1/circles/[circleId]/reports/measurements/route";
import { GET as summaryRoute } from "@/app/api/v1/circles/[circleId]/reports/route";
import { listAuditEvents } from "@/server/services/audit";
import { listDoses, recordDose } from "@/server/services/doses";
import { recordMeasurement } from "@/server/services/measurements";
import { createMedication } from "@/server/services/medications";
import { doctorSummary, measurementsCsv } from "@/server/services/reports";
import { postUpdate } from "@/server/services/updates";
import { createTeam } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
setupFakeEmail();
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const DAY = "2026-11-14";
const YESTERDAY = "2026-11-13";
const NOON = ist(DAY, "12:00");

/** Two days of a twice-daily medicine (one taken, one skipped, one nobody answered, one still to come), readings and notes. */
async function recordedCircle(label = "Metformin") {
  const team = await createTeam(db());
  const { admin, elder, caregiver, family, circle, as } = team;
  const created = ist(YESTERDAY, "06:00");
  await createMedication(as(admin, created), circle.id, { name: label, dosage: "500 mg", startDate: YESTERDAY, asNeeded: false, times: ["08:00", "20:00"], unitsPerDose: 1 });
  const { doses } = await listDoses(as(elder, ist(YESTERDAY, "08:05")), circle.id, { date: YESTERDAY, days: 2 });
  await recordDose(as(elder, ist(YESTERDAY, "08:05")), circle.id, doses[0].id, { status: "taken" });
  await recordDose(as(caregiver, ist(YESTERDAY, "20:10")), circle.id, doses[1].id, { status: "skipped", reason: "Asleep" });
  // Today's 08:00 dose is past its grace period by noon, so it becomes "unconfirmed"; 20:00 is still to come.
  await listDoses(as(elder, NOON), circle.id, { date: DAY, days: 1 });

  await recordMeasurement(as(caregiver, ist(DAY, "10:00")), circle.id, { kind: "blood_pressure", unit: "mmHg", value: 132, value2: 84, note: "=HYPERLINK(\"http://evil\")" });
  await recordMeasurement(as(caregiver, ist(DAY, "10:00")), circle.id, { kind: "weight", unit: "kg", value: 61.5, measuredAt: ist("2026-09-01", "09:00").toISOString() });
  await postUpdate(as(family, ist(DAY, "09:00")), circle.id, { body: "Walked to the temple and back." });
  const wrong = await postUpdate(as(caregiver, ist(DAY, "09:30")), circle.id, { body: "Knee pain (left)", category: "health" });
  await postUpdate(as(caregiver, ist(DAY, "09:40")), circle.id, { body: "Knee pain (right knee, not left)", category: "health", correctsUpdateId: wrong.id });
  return team;
}

describe("the 'for the doctor' summary", () => {
  it("covers the last 30 days by default: medicines with what happened to each dose, readings and notes", async () => {
    const { admin, circle, as } = await recordedCircle();
    const report = await doctorSummary(as(admin, NOON), circle.id, {});
    expect(report.period).toEqual({ from: "2026-10-16", to: DAY });
    expect(report.recipient.name).toBeTruthy();
    expect(report.generatedBy).toBe("Priya");

    expect(report.medicines).toHaveLength(1);
    // Tonight's dose hasn't happened yet, so it isn't counted.
    expect(report.medicines![0]).toMatchObject({ name: "Metformin", doses: { scheduled: 3, taken: 1, skipped: 1, unconfirmed: 1, pending: 0 } });

    // The September reading is outside the period.
    expect(report.readings!.map((r) => r.kind)).toEqual(["blood_pressure"]);
    expect(report.readings![0]).toMatchObject({ value: 132, value2: 84, recordedBy: { name: "Meena" } });

    // The corrected note is replaced by its correction.
    expect(report.notes!.map((n) => n.body)).toEqual(["Knee pain (right knee, not left)", "Walked to the temple and back."]);

    const audit = await listAuditEvents(as(admin, NOON), circle.id);
    expect(audit.find((e) => e.action === "report.generated")?.metadata).toEqual({ from: "2026-10-16", to: DAY });
  });

  it("a chosen period includes only that period", async () => {
    const { admin, circle, as } = await recordedCircle();
    const report = await doctorSummary(as(admin, NOON), circle.id, { from: "2026-08-20", to: "2026-09-30" });
    expect(report.readings!.map((r) => r.kind)).toEqual(["weight"]);
    expect(report.medicines).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  it("refuses periods in the future, backwards or too long", async () => {
    const { admin, circle, as } = await recordedCircle();
    await expect(doctorSummary(as(admin, NOON), circle.id, { to: "2026-11-15" })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(doctorSummary(as(admin, NOON), circle.id, { from: DAY, to: YESTERDAY })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(doctorSummary(as(admin, NOON), circle.id, { from: "2026-01-01", to: DAY })).rejects.toMatchObject({ code: "validation_failed" });
    const res = await summaryRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/reports?from=2026-01-01`, { cookie: admin.cookie }), params({ circleId: circle.id }));
    expect(res.status).toBe(422);
  });

  it("each section follows the reader's permissions and the parent's sharing choices", async () => {
    const { elder, family, caregiver, neighbour, circle, as } = await recordedCircle();
    // An emergency contact sees neither medicines nor health details.
    await expect(doctorSummary(as(neighbour, NOON), circle.id, {})).rejects.toMatchObject({ code: "forbidden" });

    await putConsentFor(elder, circle.id, { shareMedications: true, shareAppointments: true, shareHealth: false });
    const noHealth = await doctorSummary(as(family, NOON), circle.id, {});
    expect(noHealth.medicines).toHaveLength(1);
    expect(noHealth.readings).toBeNull();
    expect(noHealth.notes!.map((n) => n.category)).toEqual(["general"]);

    await putConsentFor(elder, circle.id, { shareMedications: false, shareAppointments: true, shareHealth: false });
    await expect(doctorSummary(as(family, NOON), circle.id, {})).rejects.toMatchObject({ code: "forbidden" });
    // The parent's choices are about family; their caregiver still sees everything.
    expect((await doctorSummary(as(caregiver, NOON), circle.id, {})).readings).toHaveLength(1);
  });

  it("never includes another family's records", async () => {
    const mine = await recordedCircle("Metformin");
    await recordedCircle("Atorvastatin");
    const report = await doctorSummary(mine.as(mine.admin, NOON), mine.circle.id, {});
    expect(report.medicines!.map((m) => m.name)).toEqual(["Metformin"]);
    expect(report.readings).toHaveLength(1);
    expect(report.notes).toHaveLength(2);
  });

  it("is 404 for outsiders, 403 without permission and 401 when signed out", async () => {
    const { neighbour, circle } = await recordedCircle();
    const outsider = await signUp();
    const call = (cookie?: string) => summaryRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/reports`, { cookie }), params({ circleId: circle.id }));
    expect((await call(outsider.cookie)).status).toBe(404);
    expect((await call(neighbour.cookie)).status).toBe(403);
    expect((await call()).status).toBe(401);
  });
});

describe("readings as CSV", () => {
  it("downloads readings in the parent's local time, with notes made safe for spreadsheets", async () => {
    const { caregiver, admin, circle, as } = await recordedCircle();
    const { csv, period } = await measurementsCsv(as(caregiver, NOON), circle.id, {});
    expect(period).toEqual({ from: "2026-10-16", to: DAY });
    expect(csv.split("\r\n")).toEqual([
      "measured_at_local,kind,value,value2,unit,context,source,recorded_by,note",
      `${DAY} 10:00,blood_pressure,132,84,mmHg,,proxy,Meena,"'=HYPERLINK(""http://evil"")"`,
      "",
    ]);
    const audit = await listAuditEvents(as(admin, NOON), circle.id);
    expect(audit.find((e) => e.action === "measurement.exported")?.metadata).toMatchObject({ count: 1 });

    // Over HTTP (the route uses the real clock): a UTF-8 download Excel opens with Indian scripts intact.
    const res = await csvRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/reports/measurements`, { cookie: caregiver.cookie }), params({ circleId: circle.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="carenest-readings-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("needs health details, follows the sharing choice, and keeps other circles out", async () => {
    const { elder, family, neighbour, circle, as } = await recordedCircle();
    const other = await recordedCircle();
    await expect(measurementsCsv(as(neighbour, NOON), circle.id, {})).rejects.toMatchObject({ code: "forbidden" });
    await putConsentFor(elder, circle.id, { shareMedications: true, shareAppointments: true, shareHealth: false });
    await expect(measurementsCsv(as(family, NOON), circle.id, {})).rejects.toMatchObject({ code: "forbidden" });
    // Someone in another circle can't read this one's readings through their own membership.
    await expect(measurementsCsv(other.as(other.admin, NOON), circle.id, {})).rejects.toMatchObject({ code: "not_found" });
    const outsider = await signUp();
    const call = (cookie?: string) => csvRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/reports/measurements`, { cookie }), params({ circleId: circle.id }));
    expect((await call(outsider.cookie)).status).toBe(404);
    expect((await call()).status).toBe(401);
  });
});
