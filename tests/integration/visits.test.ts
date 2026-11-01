import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as checkInRoute } from "@/app/api/v1/circles/[circleId]/visits/[visitId]/check-in/route";
import { GET as listRoute } from "@/app/api/v1/circles/[circleId]/visits/route";
import { notifications } from "@/server/db/schema";
import { getCircleToday } from "@/server/services/today";
import { cancelVisit, checkIn, checkOut, createVisit, latestHandover, listVisits } from "@/server/services/visits";
import { createTeam, createTestCircle } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
setupFakeEmail();
const T0 = new Date("2026-11-14T03:30:00Z"); // 09:00 in Kolkata
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

async function inbox(user: { id: string }, kind: string) {
  return (await db().select().from(notifications).where(eq(notifications.userId, user.id))).filter((n) => n.kind === kind);
}

describe("Scenario C: a caregiver visit", () => {
  it("plan → check in → check out with notes → family gets a summary; next visitor sees the handover", async () => {
    const { caregiver, family, admin, elder, clinician, circle, as } = await createTeam(db());
    const visit = await createVisit(as(caregiver, at(-24)), circle.id, { plannedStart: T0.toISOString(), plannedEnd: at(2).toISOString(), purpose: "Morning care" });
    expect(visit).toMatchObject({ status: "planned", visitor: { name: "Meena" } });

    expect((await checkIn(as(caregiver, at(0.1)), circle.id, visit.id)).status).toBe("in_progress");
    const done = await checkOut(as(caregiver, at(2)), circle.id, visit.id, {
      observations: "Ate breakfast, walked to the garden. A little breathless on stairs.",
      handoverNote: "Evening pills are in the blue box.",
      unresolvedIssues: "Bathroom tap is leaking.",
    });
    expect(done).toMatchObject({ status: "completed", handoverNote: "Evening pills are in the blue box." });

    const [summary] = await inbox(family, "visit_summary");
    expect(summary).toMatchObject({ title: "Meena finished a visit with Amma", priority: "high" });
    expect(summary.body).toContain("09:06 AM–11:00 AM");
    expect(summary.body).toContain("Unresolved: Bathroom tap is leaking.");
    expect(await inbox(admin, "visit_summary")).toHaveLength(1);
    expect(await inbox(elder, "visit_summary")).toHaveLength(1);
    expect(await inbox(caregiver, "visit_summary")).toHaveLength(0);
    expect(await inbox(clinician, "visit_summary")).toHaveLength(0);

    expect((await latestHandover(as(admin, at(3)), circle.id))?.handoverNote).toBe("Evening pills are in the blue box.");
  });

  it("a family member can record an ad-hoc visit that starts now", async () => {
    const { family, circle, as } = await createTeam(db());
    const visit = await createVisit(as(family, T0), circle.id, { startNow: true, purpose: "Dropped by with groceries" });
    expect(visit).toMatchObject({ status: "in_progress", visitor: { name: "Ravi" } });
    expect(visit.checkedInAt?.toISOString()).toBe(T0.toISOString());
  });
});

describe("visit rules", () => {
  it("only the visitor checks in and out; not too early; check out needs check in", async () => {
    const { caregiver, family, circle, as } = await createTeam(db());
    const visit = await createVisit(as(family, at(-1)), circle.id, { visitorMemberId: caregiver.memberId, plannedStart: at(5).toISOString() });
    await expect(checkIn(as(family, T0), circle.id, visit.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(checkIn(as(caregiver, T0), circle.id, visit.id)).rejects.toMatchObject({ code: "conflict" });
    await expect(checkOut(as(caregiver, at(4)), circle.id, visit.id, {})).rejects.toMatchObject({ code: "conflict" });
    expect((await checkIn(as(caregiver, at(3.5)), circle.id, visit.id)).status).toBe("in_progress");
  });

  it("caregivers plan only their own visits; emergency contacts and clinicians can't record visits", async () => {
    const { caregiver, family, neighbour, clinician, circle, as } = await createTeam(db());
    await expect(createVisit(as(caregiver, T0), circle.id, { visitorMemberId: family.memberId, plannedStart: at(5).toISOString() })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createVisit(as(neighbour, T0), circle.id, { plannedStart: at(5).toISOString() })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createVisit(as(clinician, T0), circle.id, { plannedStart: at(5).toISOString() })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("'can't make it' within 48 hours alerts admins and family to find cover", async () => {
    const { caregiver, family, admin, circle, as } = await createTeam(db());
    const visit = await createVisit(as(caregiver, at(-2)), circle.id, { plannedStart: at(20).toISOString() });
    const cancelled = await cancelVisit(as(caregiver, T0), circle.id, visit.id, { reason: "Fever" });
    expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Fever" });
    const [alert] = await inbox(family, "visit_cancelled");
    expect(alert).toMatchObject({ priority: "high", body: "Reason: Fever. Someone may need to cover this visit." });
    expect(alert.title).toMatch(/^Meena can't make the visit on /);
    expect(await inbox(admin, "visit_cancelled")).toHaveLength(1);
  });

  it("a cancellation by an organiser alerts nobody; others can't cancel someone's visit", async () => {
    const { caregiver, family, admin, elder, circle, as } = await createTeam(db());
    const visit = await createVisit(as(caregiver, at(-2)), circle.id, { plannedStart: at(20).toISOString() });
    await expect(cancelVisit(as(elder, T0), circle.id, visit.id, { reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
    await cancelVisit(as(family, T0), circle.id, visit.id, { reason: "Amma is visiting her sister" });
    expect(await inbox(admin, "visit_cancelled")).toHaveLength(0);
  });
});

describe("privacy", () => {
  it("observations are hidden from family when health details aren't shared, and the summary says so", async () => {
    const { caregiver, family, elder, circle, as } = await createTeam(db());
    await putConsentFor(elder, circle.id, { shareMedications: true, shareAppointments: true, shareHealth: false });
    const visit = await createVisit(as(caregiver, T0), circle.id, { startNow: true });
    await checkOut(as(caregiver, at(1)), circle.id, visit.id, { observations: "Low mood today", handoverNote: "Talked about her late husband" });

    const [familyView] = await listVisits(as(family, at(1)), circle.id, "recent");
    expect(familyView).toMatchObject({ observations: null, handoverNote: null, detailsHidden: true });
    const [summary] = await inbox(family, "visit_summary");
    expect(summary.body).not.toContain("Low mood");
    expect(summary.body).toContain("Details are visible only to people Amma shares health information with.");
    expect(await latestHandover(as(family, at(1)), circle.id)).toBeNull();
    // The caregiver who wrote it still sees it.
    expect((await listVisits(as(caregiver, at(1)), circle.id, "recent"))[0].observations).toBe("Low mood today");
  });

  it("outsiders get 404, including with another circle's visit id", async () => {
    const { caregiver, circle, as } = await createTeam(db());
    const visit = await createVisit(as(caregiver, T0), circle.id, { plannedStart: at(1).toISOString() });
    const outsider = await signUp();
    const own = await createTestCircle(outsider);
    expect((await listRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/visits`, { cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
    const crossed = await checkInRoute(
      apiRequest("POST", `/api/v1/circles/${own.id}/visits/${visit.id}/check-in`, { cookie: outsider.cookie }),
      params({ circleId: own.id, visitId: visit.id }),
    );
    expect(crossed.status).toBe(404);
  });
});

describe("worker: visits nobody checked in for", () => {
  it("30 minutes after the planned start, reminds the visitor and tells admins and family without assuming absence", async () => {
    const { runTick } = await import("@/server/worker/tick");
    const { caregiver, family, admin, elder, circle, as } = await createTeam(db());
    await createVisit(as(caregiver, at(-5)), circle.id, { plannedStart: T0.toISOString() });
    await runTick(db(), at(0.4));
    expect(await inbox(family, "visit_not_checked_in")).toHaveLength(0);
    await runTick(db(), at(0.51));
    const [alert] = await inbox(family, "visit_not_checked_in");
    expect(alert).toMatchObject({ title: "Meena hasn't checked in for the 09:00 AM visit", priority: "high" });
    expect(alert.body).toContain("doesn't mean they didn't come");
    expect((await inbox(caregiver, "visit_not_checked_in"))[0].title).toBe("Please check in for your 09:00 AM visit");
    expect(await inbox(admin, "visit_not_checked_in")).toHaveLength(1);
    expect(await inbox(elder, "visit_not_checked_in")).toHaveLength(0);
    await runTick(db(), at(1));
    expect(await inbox(family, "visit_not_checked_in")).toHaveLength(1);
  });

  it("no alert once the visitor has checked in", async () => {
    const { runTick } = await import("@/server/worker/tick");
    const { caregiver, family, circle, as } = await createTeam(db());
    const visit = await createVisit(as(caregiver, at(-5)), circle.id, { plannedStart: T0.toISOString() });
    await checkIn(as(caregiver, at(0.2)), circle.id, visit.id);
    await runTick(db(), at(1));
    expect(await inbox(family, "visit_not_checked_in")).toHaveLength(0);
  });
});

describe("visits stay within their own circle", () => {
  it("another family's visits, in progress or finished, never appear in a circle's lists or dashboard", async () => {
    const mine = await createTeam(db());
    const theirs = await createTeam(db());
    // In the other family: one visit in progress, one finished with private notes, one cancelled.
    const live = await createVisit(theirs.as(theirs.caregiver, at(-1)), theirs.circle.id, { plannedStart: T0.toISOString(), purpose: "Their morning care" });
    await checkIn(theirs.as(theirs.caregiver, at(0)), theirs.circle.id, live.id);
    const done = await createVisit(theirs.as(theirs.caregiver, at(-3)), theirs.circle.id, { plannedStart: at(-2).toISOString(), purpose: "Their early visit" });
    await checkIn(theirs.as(theirs.caregiver, at(-2)), theirs.circle.id, done.id);
    await checkOut(theirs.as(theirs.caregiver, at(-1)), theirs.circle.id, done.id, { observations: "Their private observations", handoverNote: "Their handover" });
    const dropped = await createVisit(theirs.as(theirs.family, at(-3)), theirs.circle.id, { visitorMemberId: theirs.caregiver.memberId, plannedStart: at(5).toISOString() });
    await cancelVisit(theirs.as(theirs.family, at(-2)), theirs.circle.id, dropped.id, { reason: "Their reason" });

    const viewer = mine.as(mine.admin, at(0.5));
    expect(await listVisits(viewer, mine.circle.id, "upcoming")).toEqual([]);
    expect(await listVisits(viewer, mine.circle.id, "recent")).toEqual([]);
    expect(await latestHandover(viewer, mine.circle.id)).toBeNull();
    expect((await getCircleToday(viewer, mine.circle.id)).visits?.today).toEqual([]);
    const res = await listRoute(apiRequest("GET", `/api/v1/circles/${mine.circle.id}/visits?range=recent`, { cookie: mine.admin.cookie }), params({ circleId: mine.circle.id }));
    expect(JSON.stringify(await res.json())).not.toMatch(/Their/);

    // And the other family still sees its own.
    expect(await listVisits(theirs.as(theirs.admin, at(0.5)), theirs.circle.id, "upcoming")).toHaveLength(1);
    expect(await listVisits(theirs.as(theirs.admin, at(0.5)), theirs.circle.id, "recent")).toHaveLength(2);
  });
});

