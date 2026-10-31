// Database schema. Tables are added milestone by milestone; each change ships with a
// generated SQL migration in `drizzle/` (npm run db:generate).

import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Key/value metadata about the running deployment (schema sanity checks, feature flags). */
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Always stored trimmed + lower-cased. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  locale: text("locale").notNull().default("en"),
  /** IANA zone, e.g. "Asia/Kolkata". Used to display times to this user. */
  timeZone: text("time_zone").notNull().default("UTC"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** Public identifier (shown in "signed-in devices"); never usable as a credential. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the cookie token; the raw token is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** Fixed-window counters for rate limiting (login, registration, invitations). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
