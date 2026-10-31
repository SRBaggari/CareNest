// Database schema. Tables are added milestone by milestone; each change ships with a
// generated SQL migration in `drizzle/` (npm run db:generate).

import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CIRCLE_ROLES, type Consent } from "@/server/auth/permissions";
import { DOSE_STATUSES } from "@/server/domain/doses";

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

// ── Care circles (M2) ────────────────────────────────────────────────────────────────────────

export const circleRole = pgEnum("circle_role", CIRCLE_ROLES);

/** The trusted network around one care recipient. Every circle-scoped row carries circle_id. */
export const careCircles = pgTable("care_circles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Archived circles are read-only (e.g. after a parent has passed away) but stay exportable. */
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const careProfiles = pgTable("care_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  circleId: uuid("circle_id")
    .notNull()
    .unique()
    .references(() => careCircles.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  preferredName: text("preferred_name"),
  dateOfBirth: date("date_of_birth"),
  /** The recipient's own IANA zone: schedules (doses, visits) are anchored to it. */
  timeZone: text("time_zone").notNull(),
  /** ISO 3166-1 alpha-2, used for the local emergency number. */
  country: text("country").notNull(),
  locale: text("locale").notNull().default("en"),
  /** Can the recipient make their own care and privacy decisions? */
  selfManaging: boolean("self_managing").notNull().default(true),
  /** The recipient's own account, when they have one. */
  linkedUserId: uuid("linked_user_id").references(() => users.id, { onDelete: "set null" }),
  emergencyNumber: text("emergency_number").notNull(),
  /** Minutes after a scheduled dose before an unanswered one is shown as unconfirmed. */
  doseGraceMinutes: integer("dose_grace_minutes").notNull().default(60),
  consent: jsonb("consent").$type<Consent>().notNull(),
  /** Optimistic concurrency: incremented on every update. */
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: circleRole("role").notNull(),
    status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
    isLegalRepresentative: boolean("is_legal_representative").notNull().default(false),
    /** Temporary access (e.g. a relief caregiver) ends automatically at this time. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [unique("memberships_circle_user_unique").on(t.circleId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: circleRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    /** If set, the resulting membership is temporary and ends at this time. */
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_circle_idx").on(t.circleId)],
);

/** Append-only record of important actions, visible to the recipient and admins. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id").references(() => careCircles.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_circle_created_idx").on(t.circleId, t.createdAt)],
);

// ── Medicines (M3) ───────────────────────────────────────────────────────────────────────────

export const doseStatus = pgEnum("dose_status", DOSE_STATUSES);

/**
 * A medicine as prescribed. Never deleted: stopping it keeps the full history. The schedule is
 * stored in the recipient's wall-clock time (see src/server/domain/schedule.ts).
 */
export const medications = pgTable(
  "medications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** As written by the prescriber, e.g. "1 tablet (500 mg)". */
    dosage: text("dosage").notNull(),
    instructions: text("instructions"),
    prescriber: text("prescriber"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    asNeeded: boolean("as_needed").notNull().default(false),
    scheduleTimes: text("schedule_times").array().notNull().default(sql`'{}'::text[]`),
    /** ISO weekdays 1–7; null means every day. */
    scheduleDays: integer("schedule_days").array(),
    /** Units of stock used per dose (for supply tracking). */
    unitsPerDose: integer("units_per_dose").notNull().default(1),
    supplyCount: integer("supply_count"),
    refillThreshold: integer("refill_threshold"),
    status: text("status", { enum: ["active", "stopped"] }).notNull().default("active"),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    stoppedBy: uuid("stopped_by").references(() => users.id, { onDelete: "set null" }),
    stopReason: text("stop_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("medications_circle_idx").on(t.circleId)],
);

/**
 * One dose: a scheduled occurrence (scheduled_for set) or an as-needed dose (scheduled_for null).
 * The current status lives here; every recording is also appended to dose_event_history.
 */
export const doseEvents = pgTable(
  "dose_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    medicationId: uuid("medication_id")
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** Recipient's local date/time as scheduled, kept for display and DST transparency. */
    localDate: date("local_date"),
    localTime: text("local_time"),
    shifted: boolean("shifted").notNull().default(false),
    status: doseStatus("status").notNull().default("scheduled"),
    /** When it actually happened (may be earlier than recorded_at for late entries). */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    source: text("source", { enum: ["self", "proxy", "caregiver"] }),
    reason: text("reason"),
    note: text("note"),
    sideEffects: text("side_effects"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("dose_events_medication_time_unique").on(t.medicationId, t.scheduledFor),
    index("dose_events_circle_time_idx").on(t.circleId, t.scheduledFor),
  ],
);

/** Append-only log of every dose recording, including corrections. */
export const doseEventHistory = pgTable(
  "dose_event_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doseEventId: uuid("dose_event_id")
      .notNull()
      .references(() => doseEvents.id, { onDelete: "cascade" }),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    status: doseStatus("status").notNull(),
    previousStatus: doseStatus("previous_status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    source: text("source", { enum: ["self", "proxy", "caregiver"] }).notNull(),
    reason: text("reason"),
    note: text("note"),
    sideEffects: text("side_effects"),
    isCorrection: boolean("is_correction").notNull().default(false),
  },
  (t) => [index("dose_event_history_dose_idx").on(t.doseEventId)],
);
