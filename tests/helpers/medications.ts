import { POST as createMedicationRoute } from "@/app/api/v1/circles/[circleId]/medications/route";
import { apiRequest, params } from "./http";
import type { TestUser } from "./users";

export const METFORMIN = {
  name: "Metformin",
  dosage: "1 tablet (500 mg)",
  instructions: "Take with food",
  prescriber: "Dr. Iyer",
  startDate: "2026-11-01",
  times: ["08:00", "20:00"],
};

export async function createTestMedication(user: TestUser, circleId: string, overrides: Record<string, unknown> = {}) {
  const res = await createMedicationRoute(
    apiRequest("POST", `/api/v1/circles/${circleId}/medications`, { cookie: user.cookie, body: { ...METFORMIN, ...overrides } }),
    params({ circleId }),
  );
  if (res.status !== 201) throw new Error(`createTestMedication failed: ${res.status} ${await res.text()}`);
  return (await res.json()).medication as { id: string; version: number; times: string[]; supplyCount: number | null };
}
