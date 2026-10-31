import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db";
import { users } from "@/server/db/schema";
import { getDummyHash, hashPassword, passwordProblem, verifyPassword } from "@/server/auth/password";
import { consumeRateLimit, resetRateLimit } from "@/server/auth/rate-limit";
import { invalidateUserSessions, type SessionUser } from "@/server/auth/session";
import { AppError } from "@/server/http";
import { emailSchema, localeSchema, nameSchema, timeZoneSchema } from "@/server/validation";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
export const LOGIN_LIMIT_PER_EMAIL = 5;
export const LOGIN_LIMIT_PER_IP = 30;
export const REGISTER_LIMIT_PER_IP = 10;

const passwordField = z.string().max(1000);

export const registerSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    password: passwordField,
    locale: localeSchema.optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v.password, v.email);
    if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
  });

export const loginSchema = z.object({ email: emailSchema, password: passwordField });

export const updateProfileSchema = z
  .object({ name: nameSchema, locale: localeSchema, timeZone: timeZoneSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export const changePasswordSchema = z.object({ currentPassword: passwordField, newPassword: passwordField });

const publicUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  locale: users.locale,
  timeZone: users.timeZone,
};

function tooManyAttempts(retryAfterSeconds: number): AppError {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return new AppError("rate_limited", `Too many attempts. Please try again in ${minutes} minute(s).`, {
    retryAfterSeconds,
  });
}

export async function registerUser(
  db: Db,
  input: z.infer<typeof registerSchema>,
  meta: { ip: string; now: Date },
): Promise<SessionUser> {
  const limit = await consumeRateLimit(db, {
    key: `register:ip:${meta.ip}`,
    limit: REGISTER_LIMIT_PER_IP,
    windowMs: ONE_HOUR,
    now: meta.now,
  });
  if (!limit.allowed) throw tooManyAttempts(limit.retryAfterSeconds);

  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      name: input.name,
      passwordHash,
      locale: input.locale ?? "en",
      timeZone: input.timeZone ?? "UTC",
      createdAt: meta.now,
      updatedAt: meta.now,
    })
    .onConflictDoNothing({ target: users.email })
    .returning(publicUserColumns);
  if (!user) throw new AppError("conflict", "An account with this email already exists. Try signing in.");
  return user;
}

/** Verifies credentials with per-email and per-IP throttling and uniform error messages. */
export async function loginUser(
  db: Db,
  input: z.infer<typeof loginSchema>,
  meta: { ip: string; now: Date },
): Promise<SessionUser> {
  const emailKey = `login:email:${input.email}`;
  for (const [key, limit] of [
    [emailKey, LOGIN_LIMIT_PER_EMAIL],
    [`login:ip:${meta.ip}`, LOGIN_LIMIT_PER_IP],
  ] as const) {
    const result = await consumeRateLimit(db, { key, limit, windowMs: FIFTEEN_MINUTES, now: meta.now });
    if (!result.allowed) throw tooManyAttempts(result.retryAfterSeconds);
  }

  const [row] = await db
    .select({ ...publicUserColumns, passwordHash: users.passwordHash, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  const valid = await verifyPassword(input.password, row?.passwordHash ?? (await getDummyHash()));
  if (!row || !valid || row.disabledAt) {
    throw new AppError("unauthenticated", "Email or password is incorrect.");
  }
  await resetRateLimit(db, emailKey);
  return { id: row.id, email: row.email, name: row.name, locale: row.locale, timeZone: row.timeZone };
}

export async function updateProfile(
  db: Db,
  userId: string,
  input: z.infer<typeof updateProfileSchema>,
  now: Date,
): Promise<SessionUser> {
  const [user] = await db
    .update(users)
    .set({ ...input, updatedAt: now })
    .where(eq(users.id, userId))
    .returning(publicUserColumns);
  if (!user) throw new AppError("not_found", "Account not found.");
  return user;
}

/** Changes the password and signs out every other device. */
export async function changePassword(
  db: Db,
  input: z.infer<typeof changePasswordSchema> & { userId: string; currentSessionId: string; now: Date },
): Promise<void> {
  const [row] = await db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!row || !(await verifyPassword(input.currentPassword, row.passwordHash))) {
    throw new AppError("validation_failed", "Some fields are invalid.", {
      currentPassword: ["Your current password is incorrect."],
    });
  }
  const problem = passwordProblem(input.newPassword, row.email);
  if (problem) throw new AppError("validation_failed", "Some fields are invalid.", { newPassword: [problem] });

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.newPassword), updatedAt: input.now })
    .where(eq(users.id, input.userId));
  await invalidateUserSessions(db, input.userId, input.currentSessionId);
}
