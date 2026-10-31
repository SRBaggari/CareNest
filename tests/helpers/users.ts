import { randomUUID } from "node:crypto";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { apiRequest, sessionCookieFrom } from "./http";

export const TEST_PASSWORD = "correct horse battery staple";

export type TestUser = { id: string; email: string; name: string; cookie: string };

/** Registers a new user through the real API and returns their session cookie. */
export async function signUp(overrides: { name?: string; email?: string; timeZone?: string } = {}): Promise<TestUser> {
  const email = overrides.email ?? `user-${randomUUID()}@example.test`;
  const name = overrides.name ?? "Test User";
  const res = await register(
    apiRequest("POST", "/api/v1/auth/register", {
      body: { email, name, password: TEST_PASSWORD, timeZone: overrides.timeZone },
    }),
  );
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${await res.text()}`);
  const { user } = await res.json();
  return { id: user.id, email: user.email, name: user.name, cookie: sessionCookieFrom(res) };
}
