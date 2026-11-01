// Database schema. Tables are added milestone by milestone; each change ships with a
// generated SQL migration in `drizzle/` (npm run db:generate).

import { boolean, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  /**
   * Fingerprint of the dose schedule the worker last materialised (local date, zone, each scheduled
   * medicine's id/version/status). The worker regenerates doses only when it changes.
   */
  dosesPreparedKey: text("doses_prepared_key"),
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
    /** Per-person alert choices for this circle; null means the default for their role. */
    notifyDoseReminders: boolean("notify_dose_reminders"),
    notifyUnconfirmedDoses: boolean("notify_unconfirmed_doses"),
    notifyRefills: boolean("notify_refills"),
    notifyAppointments: boolean("notify_appointments"),
    notifyTasks: boolean("notify_tasks"),
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
    /** Set when a low-stock alert went out; cleared on restock so the next low point alerts again. */
    refillAlertedAt: timestamp("refill_alerted_at", { withTimezone: true }),
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
    /** When the circle was told this dose is unconfirmed, and when that was escalated. */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
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

// ── Notifications (M4) ───────────────────────────────────────────────────────────────────────

export const notificationPriority = pgEnum("notification_priority", ["low", "normal", "high", "critical"]);

/**
 * In-app notification for one user. `dedupe_key` makes creation idempotent (a retried worker
 * never notifies twice); `group_key` ties together the notifications about one event so that
 * one person acknowledging ("I'm checking on it") is visible to everyone else.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    circleId: uuid("circle_id").references(() => careCircles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    priority: notificationPriority("priority").notNull().default("normal"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** In-app path to open, e.g. /app/circles/<id>/medicines. */
    link: text("link"),
    groupKey: text("group_key"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt), index("notifications_group_idx").on(t.groupKey)],
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  /** Quiet hours in the user's own time zone ("HH:MM"); critical alerts ignore them. */
  quietStart: text("quiet_start"),
  quietEnd: text("quiet_end"),
  /** One evening email listing the day's low-priority news (visits, everyday updates) instead of none. */
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  /** When the last digest was queued; the worker claims a person's day with it so only one is sent. */
  lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Outgoing email queue. Rows are claimed with a lock so concurrent workers never double-send,
 * retried with backoff, and their body is erased once delivered or abandoned (bodies can contain
 * single-use invitation links).
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    kind: text("kind").notNull(),
    notificationId: uuid("notification_id").references(() => notifications.id, { onDelete: "set null" }),
    /** sent = accepted by the mail provider; logged = no provider configured, only written to the server log. */
    status: text("status", { enum: ["pending", "sending", "sent", "logged", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("email_outbox_due_idx").on(t.status, t.nextAttemptAt), index("email_outbox_notification_idx").on(t.notificationId)],
);

// ── Phone alerts: web push (Tier 2) ──────────────────────────────────────────────────────────

/**
 * A browser on one device that asked for alerts. The endpoint is the push service URL the browser
 * gave us (only well-known push services are accepted); p256dh/auth encrypt the message to it.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** A readable device name for the Account page, e.g. "Chrome on Android". */
    label: text("label"),
    createdAt: createdAt(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

/** Outgoing phone alerts, claimed and retried like emails; the payload is erased once delivered. */
export const pushOutbox = pgTable(
  "push_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    notificationId: uuid("notification_id").references(() => notifications.id, { onDelete: "set null" }),
    /** JSON shown by the service worker: title, body, link, tag, urgent. */
    payload: text("payload"),
    urgent: boolean("urgent").notNull().default(false),
    /** gone = the push service says this device no longer exists; its subscription is removed. */
    status: text("status", { enum: ["pending", "sending", "sent", "failed", "gone"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("push_outbox_due_idx").on(t.status, t.nextAttemptAt)],
);

// ── Calendar subscriptions (Tier 2) ──────────────────────────────────────────────────────────

/**
 * A private calendar link for one person and one circle. The link itself is the key, so only its
 * hash is stored; making a new link revokes the old one.
 */
export const calendarFeeds = pgTable(
  "calendar_feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("calendar_feeds_user_circle_idx").on(t.userId, t.circleId)],
);

// ── Health documents (Tier 2) ────────────────────────────────────────────────────────────────

/**
 * A health document (prescription, report, discharge summary…) with one or more versions. Removing a
 * document deletes its files; the row stays (with who removed it) so the activity log still makes sense.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category", { enum: ["prescription", "report", "discharge", "insurance", "other"] }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("documents_circle_idx").on(t.circleId, t.createdAt)],
);

/** One uploaded file. The storage key is random; the file name is only shown, never used on disk. */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    note: text("note"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("document_versions_document_idx").on(t.documentId, t.uploadedAt)],
);

/** Who opened which document, and when: shown on the document so families can see who looked at it. */
export const documentAccess = pgTable(
  "document_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => documentVersions.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [index("document_access_document_idx").on(t.documentId, t.at)],
);

// ── Circle messages (Tier 2) ─────────────────────────────────────────────────────────────────

/** A conversation in a circle: general, or about one appointment or task (one thread per subject). */
export const messageThreads = pgTable(
  "message_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subjectType: text("subject_type", { enum: ["general", "appointment", "task"] }).notNull().default("general"),
    subjectId: uuid("subject_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("message_threads_circle_last_idx").on(t.circleId, t.lastMessageAt), unique("message_threads_subject_unique").on(t.circleId, t.subjectType, t.subjectId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Erased when the author removes the message; the row stays so replies still make sense. */
    body: text("body"),
    createdAt: createdAt(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [index("messages_thread_created_idx").on(t.threadId, t.createdAt)],
);

/** How far each person has read a thread, for unread markers. */
export const threadReads = pgTable(
  "thread_reads",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] })],
);

// ── Appointments (M5) ────────────────────────────────────────────────────────────────────────

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["in_person", "virtual", "home_visit"] }).notNull().default("in_person"),
    clinician: text("clinician"),
    location: text("location"),
    virtualUrl: text("virtual_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    reason: text("reason"),
    /** Questions the family wants to ask; prepared before the visit. */
    questions: text("questions"),
    status: text("status", { enum: ["scheduled", "completed", "cancelled"] }).notNull().default("scheduled"),
    transportNeeded: boolean("transport_needed").notNull().default(true),
    /** Who has said they will take the recipient there. This is a commitment, not a booking. */
    transportMemberId: uuid("transport_member_id").references(() => memberships.id, { onDelete: "set null" }),
    transportNote: text("transport_note"),
    companionMemberId: uuid("companion_member_id").references(() => memberships.id, { onDelete: "set null" }),
    /** Post-visit summary as reported by a member (not a clinical record). */
    outcomeNote: text("outcome_note"),
    followUp: text("follow_up"),
    outcomeBy: uuid("outcome_by").references(() => users.id, { onDelete: "set null" }),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    transportAlertedAt: timestamp("transport_alerted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("appointments_circle_starts_idx").on(t.circleId, t.startsAt)],
);

// ── Family tasks (M5) ────────────────────────────────────────────────────────────────────────

export const TASK_CATEGORIES = ["medication", "appointment", "transport", "shopping", "bills", "home", "paperwork", "other"] as const;

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    category: text("category", { enum: TASK_CATEGORIES }).notNull().default("other"),
    /** Null = nobody has taken it yet, which is shown prominently so it isn't silently forgotten. */
    assigneeMemberId: uuid("assignee_member_id").references(() => memberships.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: text("priority", { enum: ["low", "normal", "high"] }).notNull().default("normal"),
    status: text("status", { enum: ["open", "done", "cancelled"] }).notNull().default("open"),
    recurrence: text("recurrence", { enum: ["none", "daily", "weekly", "monthly"] }).notNull().default("none"),
    /** Set on a completed recurring task once its next occurrence exists (makes completion idempotent). */
    nextTaskId: uuid("next_task_id"),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    completionNote: text("completion_note"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    dueReminderSentAt: timestamp("due_reminder_sent_at", { withTimezone: true }),
    overdueAlertedAt: timestamp("overdue_alerted_at", { withTimezone: true }),
    unassignedAlertedAt: timestamp("unassigned_alerted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_circle_status_due_idx").on(t.circleId, t.status, t.dueAt)],
);

// ── Caregiver visits (M6) ────────────────────────────────────────────────────────────────────

/**
 * A planned or ad-hoc visit by a caregiver or relative. Check-in/out times are self-reported:
 * they record what the visitor says, not verified presence.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    visitorMemberId: uuid("visitor_member_id").references(() => memberships.id, { onDelete: "set null" }),
    plannedStart: timestamp("planned_start", { withTimezone: true }).notNull(),
    plannedEnd: timestamp("planned_end", { withTimezone: true }),
    status: text("status", { enum: ["planned", "in_progress", "completed", "cancelled"] }).notNull().default("planned"),
    purpose: text("purpose"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    /** How the person seemed and what was done: health-related, so shown only with health.view. */
    observations: text("observations"),
    handoverNote: text("handover_note"),
    unresolvedIssues: text("unresolved_issues"),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    notCheckedInAlertedAt: timestamp("not_checked_in_alerted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("visits_circle_start_idx").on(t.circleId, t.plannedStart)],
);

// ── Care updates (M6) ────────────────────────────────────────────────────────────────────────

/**
 * A short note shared with the circle. Never edited: a correction is a new update pointing at
 * the original, so the record shows what was said and when.
 */
export const careUpdates = pgTable(
  "care_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** health/mood notes follow the recipient's health-sharing choice. */
    category: text("category", { enum: ["general", "health", "mood"] }).notNull().default("general"),
    important: boolean("important").notNull().default(false),
    correctsUpdateId: uuid("corrects_update_id").references((): AnyPgColumn => careUpdates.id, { onDelete: "set null" }),
    /** Set when the update is the parent's daily "How are you today?" answer. */
    checkin: text("checkin", { enum: ["fine", "unwell", "need"] }),
    createdAt: createdAt(),
  },
  (t) => [index("care_updates_circle_created_idx").on(t.circleId, t.createdAt)],
);

// ── Health readings (Tier 2) ─────────────────────────────────────────────────────────────────

/**
 * One reading (blood pressure, sugar, weight, temperature, pulse, oxygen). Values are stored in one
 * unit per kind (mmHg, mg/dL, kg, °C, bpm, %) and shown in the unit they were entered in. A reading
 * entered by mistake is removed (hidden, with who and when), never edited.
 */
export const measurements = pgTable(
  "measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["blood_pressure", "blood_sugar", "weight", "temperature", "pulse", "oxygen"] }).notNull(),
    value: doublePrecision("value").notNull(),
    /** Diastolic, for blood pressure. */
    value2: doublePrecision("value2"),
    unit: text("unit").notNull(),
    /** Blood sugar only: fasting, before_meal, after_meal, bedtime, random. */
    context: text("context"),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    /** self = the person receiving care entered it; proxy = someone else did. */
    source: text("source", { enum: ["self", "proxy"] }).notNull(),
    note: text("note"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("measurements_circle_kind_measured_idx").on(t.circleId, t.kind, t.measuredAt)],
);

// ── Emergency assistance (M7) ────────────────────────────────────────────────────────────────

/** The emergency information card: what a responder or hospital needs to know at a glance. */
export type EmergencyInfo = {
  conditions?: string | null;
  allergies?: string | null;
  medicationsNote?: string | null;
  bloodGroup?: string | null;
  doctorName?: string | null;
  doctorPhone?: string | null;
  preferredHospital?: string | null;
  insuranceNote?: string | null;
  advanceDirectiveNote?: string | null;
  communicationNote?: string | null;
  mobilityNote?: string | null;
  homeAccessNote?: string | null;
};

export const emergencyInfoCards = pgTable("emergency_info_cards", {
  circleId: uuid("circle_id")
    .primaryKey()
    .references(() => careCircles.id, { onDelete: "cascade" }),
  info: jsonb("info").$type<EmergencyInfo>().notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * People to call in an emergency. A contact linked to a circle member receives in-app/email
 * alerts in their tier's turn; contacts without an account are listed for one-tap calling only.
 */
export const emergencyContacts = pgTable(
  "emergency_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    relationship: text("relationship"),
    notes: text("notes"),
    /** Alert order: tier 1 is alerted first, then tier 2 if nobody responds, and so on. */
    tier: integer("tier").notNull().default(1),
    memberId: uuid("member_id").references(() => memberships.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("emergency_contacts_circle_idx").on(t.circleId)],
);

export const assistanceRequests = pgTable(
  "assistance_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    raisedBy: uuid("raised_by").references(() => users.id, { onDelete: "set null" }),
    message: text("message"),
    status: text("status", { enum: ["open", "acknowledged", "resolved", "cancelled"] }).notNull().default("open"),
    /** Practice drills are labelled everywhere and never escalate beyond the first tier. */
    isPractice: boolean("is_practice").notNull().default(false),
    /** Only present when the person chose to share their location for this one alert. */
    location: jsonb("location").$type<{ latitude: number; longitude: number; accuracyMeters: number | null }>(),
    escalationStep: integer("escalation_step").notNull().default(0),
    nextEscalationAt: timestamp("next_escalation_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
  },
  (t) => [index("assistance_requests_circle_idx").on(t.circleId, t.createdAt)],
);

/**
 * A shared care cost. Amounts are whole minor units (paise, pence). People are referenced by
 * membership, so a removed member's history stays; if their account is deleted the reference becomes
 * null and they show as a former member. Removing an expense hides it (kept for the activity log).
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    category: text("category", { enum: ["medicine", "doctor", "caregiver", "transport", "household", "equipment", "other"] }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    spentOn: date("spent_on").notNull(),
    paidBy: uuid("paid_by").references(() => memberships.id, { onDelete: "set null" }),
    splitMode: text("split_mode", { enum: ["equal", "custom", "payer_only"] }).notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("expenses_circle_spent_idx").on(t.circleId, t.spentOn)],
);

/** Each person's part of an expense; the parts always add up to the expense's amount. */
export const expenseShares = pgTable(
  "expense_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => memberships.id, { onDelete: "set null" }),
    amountMinor: integer("amount_minor").notNull(),
  },
  (t) => [index("expense_shares_expense_idx").on(t.expenseId)],
);

/** Money paid back between two people ("Ravi paid Priya ₹700"). */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => careCircles.id, { onDelete: "cascade" }),
    fromMember: uuid("from_member").references(() => memberships.id, { onDelete: "set null" }),
    toMember: uuid("to_member").references(() => memberships.id, { onDelete: "set null" }),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    paidOn: date("paid_on").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("settlements_circle_idx").on(t.circleId)],
);
