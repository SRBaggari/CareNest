import { PUT as putConsent } from "@/app/api/v1/circles/[circleId]/consent/route";
import type { Consent } from "@/server/auth/permissions";
import { apiRequest, params } from "./http";
import type { TestUser } from "./users";

export async function putConsentFor(user: TestUser, circleId: string, consent: Consent) {
  const res = await putConsent(
    apiRequest("PUT", `/api/v1/circles/${circleId}/consent`, { cookie: user.cookie, body: consent }),
    params({ circleId }),
  );
  if (res.status !== 200) throw new Error(`putConsentFor failed: ${res.status} ${await res.text()}`);
}
