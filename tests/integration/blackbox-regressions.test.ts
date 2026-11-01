// Regression tests for defects found by black-box testing (see docs/TEST-REPORT.md).

import { describe, expect, it } from "vitest";
import { GET as unknownApi } from "@/app/api/[...path]/route";
import { GET as dosesRoute } from "@/app/api/v1/circles/[circleId]/doses/route";
import { POST as createMedRoute } from "@/app/api/v1/circles/[circleId]/medications/route";
import { listDoses } from "@/server/services/doses";
import { createMedication } from "@/server/services/medications";
import { createTeam } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";

const db = setupTestDb();

describe("black-box regressions", () => {
  it("F1 (critical): a far-future dose date is rejected quickly instead of exhausting server memory", async () => {
    const { admin, circle, as } = await createTeam(db());
    for (const name of ["A", "B", "C"]) {
      await createMedication(as(admin, new Date("2026-11-01T00:00:00Z")), circle.id, { name, dosage: "1", startDate: "2026-11-01", asNeeded: false, times: ["08:00"], unitsPerDose: 1 });
    }
    const started = Date.now();
    const res = await dosesRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/doses?date=9999-12-31`, { cookie: admin.cookie }), params({ circleId: circle.id }));
    expect(res.status).toBe(422);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("F2: impossible calendar dates are 422, not 500", async () => {
    const { admin, circle } = await createTeam(db());
    for (const date of ["2026-02-30", "2026-13-45", "0000-00-00"]) {
      const res = await dosesRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/doses?date=${date}`, { cookie: admin.cookie }), params({ circleId: circle.id }));
      expect([date, res.status]).toEqual([date, 422]);
    }
    const med = await createMedRoute(
      apiRequest("POST", `/api/v1/circles/${circle.id}/medications`, { cookie: admin.cookie, body: { name: "M", dosage: "1", times: ["08:00"], startDate: "2026-02-30" } }),
      params({ circleId: circle.id }),
    );
    expect(med.status).toBe(422);
  });

  it("F4: a medicine added in the evening has no 'unconfirmed' doses for earlier that day", async () => {
    const { admin, circle, as } = await createTeam(db());
    const evening = new Date("2026-11-14T22:00:00+05:30");
    await createMedication(as(admin, evening), circle.id, { name: "M", dosage: "1", startDate: "2026-11-14", asNeeded: false, times: ["08:00", "23:00"], unitsPerDose: 1 });
    const { doses } = await listDoses(as(admin, evening), circle.id, { date: "2026-11-14", days: 1 });
    expect(doses.map((d) => [d.localTime, d.status])).toEqual([["23:00", "scheduled"]]);
  });

  it("F7: unknown API paths answer with the JSON error format", async () => {
    const res = await unknownApi(new Request("http://localhost/api/v1/nope"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "There is no such API endpoint." } });
  });
});
