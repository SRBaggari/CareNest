# CareNest — Product & Engineering Plan

> Status: living document. Last updated 2026-10-31 (M0 + M1 complete).
> Target: working, demonstrable MVP (Tier 1) on **2026-12-01**.
> Every section marks what is **implemented**, **in progress**, or **planned** — see the roadmap table at the end.

---

## 1. Product name

**CareNest** — already the repository name, short, warm, non-clinical, and works across languages
("a nest of people around the person being cared for"). Recommended to keep it.

## 2. Vision analysis — what families actually struggle with

The core problem is not a lack of data, it is **uncertainty and diffuse responsibility**:

| Real problem | What CareNest must do |
|---|---|
| "Did Mum take her pills?" — nobody knows, and silence is ambiguous | Record dose events with an explicit status; never treat *no answer* as *taken* or *missed* — it is **unconfirmed** |
| Siblings assume someone else is handling it | Every task / appointment / transport has a named owner or is visibly **unassigned** |
| Information lives in WhatsApp threads and one sibling's head | One timeline per care recipient, every entry with author, source and time |
| Child abroad sees a different time zone | All times stored UTC, displayed in the viewer's zone *and* the care recipient's local zone |
| Elder is talked *about*, not *with* | Elder has their own account, simplified UI, and privacy controls the family admin cannot silently override |
| Emergency → panic, unclear who responds | One-tap local emergency number + ordered family alert sequence with visible acknowledgments and failures |
| Caregiver changes; knowledge is lost | Handover notes, visit logs, immediate access revocation |

### 2.1 Missing requirements & overlooked edge cases (added to scope)

1. **Capacity changes over time.** A self-managing elder may later need a legal representative. Model a
   `self_managing` flag on the care profile plus an optional *legal representative* membership flag;
   changing it is audited and requires admin + (if self-managing) elder confirmation.
2. **Elder without a smartphone.** Every elder action must also be recordable *on behalf of* the elder
   by family/caregiver, with `source = proxy` shown in the timeline.
3. **Backdated records.** "She took it at 9, I'm entering it at 11." Distinguish `occurred_at` from
   `recorded_at` on every event.
4. **As-needed (PRN) medications** — no schedule, only ad-hoc administration records.
5. **DST & cross-zone schedules.** Schedules are anchored to the care recipient's IANA time zone; a
   08:00 dose stays 08:00 local even when a sibling's zone shifts for DST. Non-existent local times
   (DST gaps) are shifted forward and flagged.
6. **Duplicate generation / double notification.** Dose events and notifications use unique keys so
   a retried worker never produces duplicates.
7. **Last-admin problem.** A circle must always keep at least one active admin; a self-managing elder
   can always remove an admin.
8. **Bereavement / end of care.** Circles can be *archived* (read-only, exportable) rather than deleted
   abruptly.
9. **Shared/family device for the elder.** Long-lived session on a tablet is acceptable but must be
   revocable remotely from the security page.
10. **Notification fatigue.** Priority levels + quiet hours + daily digest for low-priority updates;
    critical alerts bypass quiet hours.
11. **Conflicting edits** from two siblings — optimistic concurrency (`version` column) on editable
    records; the second save gets a clear conflict message instead of silently overwriting.
12. **Wrong-email invitations.** Invitations are single-use, expiring, revocable, and show the inviter's
    name; accepting requires signing in as the invited email.
13. **Country-specific emergency numbers** (112 India, 911 US, 999 UK, 112 EU) stored per care profile.
14. **Abuse safeguards.** The elder (when self-managing) can see the audit log of who viewed their
    records — protects against financial/emotional abuse by a family member.

## 3. Tiers

### Tier 1 — MVP (by 2026-12-01)
Authentication & sessions · Care Circles & care profiles · invitations · role/permission engine with
elder consent controls · audit log · medications, schedules, dose confirmation, unconfirmed handling ·
appointments with transport/companion owners · family & caregiver tasks (recurring, overdue escalation) ·
caregiver visits (check-in/out, observations, handover) · shared care updates & unified timeline ·
in-app notifications + email channel adapter, reminders, escalation, quiet hours, delivery tracking ·
emergency contacts, emergency info card, assistance request with alert sequence & acknowledgment ·
role-specific accessible dashboards (elder simplified UI) · i18n architecture (en complete, hi/te/ta
partial) · CI, deployment config, docs.

### Tier 2 — Enhanced (Dec 2026 – Feb 2027)
Health documents (upload, versions, access history) · daily well-being check-ins & measurements with
charts · circle discussions & messages · reports & exports · AI assistant (grounded summaries, Q&A with
citations, permission-filtered retrieval) · voice-first elder mode (Web Speech API) · expenses ·
web push & SMS channels · external calendar export (ICS) · PWA offline read cache.

### Tier 3 — Advanced (2027+)
Wearables/device import · smart home · telehealth · caregiver marketplace (needs verification & legal
review) · advanced analytics (operational only — no unvalidated medical risk prediction) · expanded
offline write support · native mobile apps.

### Feature-priority matrix (Tier 1 decisions)

| Feature | User value | Complexity | Privacy risk | Safety risk | MVP? |
|---|---|---|---|---|---|
| Auth & sessions | Essential | M | High | — | ✅ |
| Care circles, roles, consent | Essential | M | High | Med | ✅ |
| Medications & dose confirmation | Very high | H | High | **High** | ✅ |
| Notifications & escalation | Very high | H | Med | **High** | ✅ |
| Appointments + transport owner | High | M | Med | Low | ✅ |
| Tasks | High | M | Low | Low | ✅ |
| Caregiver visits & handover | High | M | Med | Med | ✅ |
| Emergency assistance | High | M | Med | **High** | ✅ (no claims of dispatch) |
| Timeline / audit | High | M | Med | Low | ✅ |
| Documents | High | H | **High** | Low | Tier 2 |
| AI assistant | Med | H | **High** | Med | Tier 2 |
| Voice | Med | M | Med | Med | Tier 2 |
| Expenses | Med | M | Med | Low | Tier 2 |
| Wearables / smart home | Low-Med | H | High | High | Tier 3 |

## 4. Roles & permissions

A **Care Circle** is the trusted network around **one** care recipient (one `care_profile` per circle).
A family caring for two parents has two circles; users switch between circles they belong to.
*Trade-off:* simpler, isolation-by-construction (every record carries `circle_id`) vs. needing to invite
a sibling twice — accepted; a "copy members from another circle" helper is planned.

Roles (per membership, a user can hold different roles in different circles):
`care_recipient`, `admin`, `family`, `caregiver`, `clinician`, `emergency_contact`.
Platform operators are **not** a circle role and have no route to circle data.

Capabilities (✅ allowed, ◐ allowed unless the care recipient restricts it via consent settings, — denied):

| Capability | care_recipient | admin | family | caregiver | clinician | emergency_contact |
|---|---|---|---|---|---|---|
| circle.view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (limited) |
| circle.manage (settings, archive) | ✅ if self-managing | ✅ | — | — | — | — |
| members.invite / manage | ✅ if self-managing | ✅ | — | — | — | — |
| consent.manage | ✅ if self-managing | ✅ only if **not** self-managing | — | — | — | — |
| medication.view | ✅ | ◐ | ◐ | ✅ | ✅ | — |
| medication.manage | ✅ | ✅ | — | — | ✅ | — |
| dose.record | ✅ | ✅ | ✅ | ✅ | — | — |
| appointment.view | ✅ | ◐ | ◐ | ✅ | ✅ | — |
| appointment.manage | ✅ | ✅ | ✅ | — | ✅ | — |
| task.view / task.complete | ✅ | ✅ | ✅ | ✅ (assigned+circle) | — | — |
| task.manage | ✅ | ✅ | ✅ | — | — | — |
| visit.record (check-in/out) | — | ✅ | ✅ | ✅ | — | — |
| update.view / update.post | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| health.view (observations, notes) | ✅ | ◐ | ◐ | ✅ | ✅ | — |
| emergency.view (info card, contacts) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| emergency.raise / acknowledge | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| audit.view | ✅ | ✅ | — | — | — | — |

Rules: admin powers never override a self-managing recipient's consent; temporary memberships have
`expires_at`; revocation is immediate (checked on every request, no cached grants).
The matrix lives in code as a pure function (`src/server/auth/permissions.ts`) and is exhaustively unit-tested.

## 5. Core user journeys (acceptance tests)

Each journey becomes an end-to-end/integration test suite.

- **A — Family abroad:** child (Europe/London) signs up → creates circle for parent (Asia/Kolkata) →
  invites sibling (family) and caregiver → caregiver accepts → schedule shows both zones.
- **B — Medication confirmation:** 08:00 IST dose generated → reminder notification → parent taps
  "I took it" → timeline entry; alternate path: no response → status `unconfirmed` at grace end →
  escalation to configured family contacts. Never auto-"missed".
- **C — Caregiver visit:** caregiver sees today's visit & tasks → check-in → completes tasks, adds
  observation → check-out with handover note → family gets summary notification.
- **D — Appointment:** sibling 1 schedules → sibling 2 takes transport → post-visit note + follow-up
  tasks created, each attributed to its author.
- **E — Emergency:** parent presses Help → screen shows local number (112) to call + "notify family"
  → alerts sent in configured order → acknowledgments visible; unacknowledged after N minutes →
  next contact; failed deliveries shown in red. No claim that emergency services were contacted.
- **F — Two parents:** user in two circles switches profiles; tests assert zero cross-circle leakage
  on every endpoint.
- **G — AI summary (Tier 2):** summary built only from authorized records with citations.

## 6. Technology stack & decisions

| Concern | Choice | Why / trade-off |
|---|---|---|
| App framework | **Next.js (App Router) + TypeScript** | One deployable for UI + API, server components keep PHI off the client unless needed. Trade-off: framework churn; mitigated by keeping business logic in plain TS services. |
| Database | **PostgreSQL** (prod) / **PGlite** (dev & tests) | Real Postgres semantics everywhere, no Docker needed locally; tests run against the same SQL dialect as production. |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Typed SQL, plain SQL migrations committed to git, first-class PGlite + node-postgres drivers. |
| Validation | **Zod** | Shared schemas for API input and forms. |
| Auth | Own session auth: scrypt password hashing (Node crypto), random session tokens stored **hashed** in DB, httpOnly SameSite=Lax cookies, Origin checks on mutations, login rate limiting | Small, auditable, no third-party dependency for the most sensitive path. OAuth/passkeys later. |
| Background work | **DB-backed job queue** (`jobs` table, `FOR UPDATE SKIP LOCKED`) + worker process | No Redis to operate; jobs are durable, retryable, idempotent. |
| Notifications | Outbox (`notifications` + `notification_deliveries`) with channel adapters: in-app (real), email (SMTP adapter; console transport in dev) | Delivery ≠ acknowledgment — tracked separately. |
| Time | **Luxon** with IANA zones | DST-correct schedule expansion. |
| i18n | **next-intl** (no locale routing; per-user preference) | Strings in `messages/*.json` from day one. |
| UI | Tailwind CSS, hand-built accessible components, 18px+ base text, 48px touch targets | No heavy component library; full control of a11y. |
| Tests | **Vitest** (unit + integration on PGlite), **Playwright + axe** (E2E & accessibility, from M8) | Fast, same language. |
| CI | GitHub Actions: lint → typecheck → unit → integration → build on every push & PR | |
| Hosting (recommended) | Any Node host (Render/Railway/Fly/VM) + managed Postgres (Neon/Supabase/RDS, region near users) + worker process | Not serverless-only, because the reminder worker must run continuously. |

Not chosen: microservices (premature), Firebase (weaker relational integrity/audit), Redis (unneeded).

## 7. Architecture

```
Browser (RSC pages + small client components)
   │  fetch /api/v1/*  (JSON, cookie session, Origin-checked)
   ▼
Next.js server ─ route handlers ─► services (business rules, authz, audit) ─► Drizzle ─► Postgres
                                         ▲                                         ▲
Worker process (npm run worker) ─ job handlers: expand doses, mark unconfirmed,     │
                                  send reminders, deliver notifications, escalate ──┘
```

Layering rules:
- `src/server/services/*` — all business logic; every function takes `(ctx, input)` where
  `ctx = { db, actor, now }`. **Authorization happens here**, not in the UI.
- `src/app/api/v1/*` — thin: parse session, validate with Zod, call service, map errors to HTTP.
- Server components read through the same services (same authorization path).
- `now` is injected → time-dependent logic is deterministic in tests.

## 8. Data model (Tier 1)

All tables have `id uuid pk`, `created_at`; circle-scoped tables carry `circle_id` (FK, indexed) and
every query filters by it.

- `users` (email unique, name, password_hash, locale, time_zone, disabled_at)
- `sessions` (token_hash pk, user_id, expires_at, last_seen_at, user_agent)
- `login_attempts` (key, window_start, count) — rate limiting
- `care_circles` (name, status active/archived, created_by)
- `care_profiles` (circle_id unique, display_name, preferred_name, date_of_birth, time_zone, country,
  locale, self_managing, linked_user_id, emergency_number, emergency_info jsonb, consent jsonb, version)
- `memberships` (circle_id, user_id, role, status active/revoked, is_legal_representative,
  expires_at, revoked_at, revoked_by) unique(circle_id,user_id)
- `invitations` (circle_id, email, role, token_hash, invited_by, expires_at, accepted_at, revoked_at)
- `audit_events` (circle_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) — append-only
- `medications` (name, dosage, instructions, prescriber, start_date, end_date, as_needed, active,
  supply_count, refill_threshold, version)
- `medication_schedules` (medication_id, local_times text[], days_of_week int[] | null)
- `dose_events` (medication_id, circle_id, scheduled_for, status, occurred_at, recorded_at,
  recorded_by, source self/proxy/caregiver, reason, note) unique(medication_id, scheduled_for)
- `appointments` (title, clinician, location, virtual_url, starts_at, ends_at, reason, status,
  transport_member_id, companion_member_id, questions, outcome_note, version)
- `tasks` (title, notes, assignee_member_id, due_at, priority, status, recurrence, completed_at,
  completed_by, version)
- `visits` (caregiver_member_id, planned_start, planned_end, checked_in_at, checked_out_at,
  observations, handover_note, unresolved_issues, status)
- `timeline_events` (circle_id, kind, ref_type, ref_id, actor_user_id, source, occurred_at,
  summary, corrects_event_id) — append-only, corrections reference the original
- `notifications` (user_id, circle_id, kind, priority, title, body, dedupe_key unique, read_at,
  acknowledged_at) + `notification_deliveries` (channel, status, attempts, last_error, next_attempt_at)
- `notification_preferences` (user_id, quiet_start, quiet_end, channels, digest)
- `emergency_contacts` (circle_id, name, phone, relationship, order, member_id null)
- `assistance_requests` (raised_by, source, status open/acknowledged/resolved, created_at) +
  `assistance_acknowledgments`
- `jobs` (type, payload, run_at, status, attempts, locked_until, last_error, dedupe_key unique)

## 9. API (v1, JSON)

`POST /api/v1/auth/{register,login,logout}` · `GET /api/v1/me`
`GET|POST /api/v1/circles` · `GET|PATCH /api/v1/circles/:id` · `.../profile` · `.../consent`
`GET|POST /api/v1/circles/:id/invitations` · `POST /api/v1/invitations/:token/accept`
`GET|PATCH|DELETE /api/v1/circles/:id/members/:memberId`
`/api/v1/circles/:id/medications[/:medId]` · `.../doses?date=` · `POST .../doses/:doseId/record`
`/api/v1/circles/:id/appointments[...]` · `/tasks[...]` · `/visits[...]` · `/updates` · `/timeline`
`/api/v1/circles/:id/emergency/{contacts,info,requests}` · `POST .../requests/:id/acknowledge`
`GET /api/v1/notifications` · `POST /api/v1/notifications/:id/{read,acknowledge}`
Errors: `{ error: { code, message } }` with 400/401/403/404/409/422/429. 404 (not 403) for circles the
user is not a member of, to avoid leaking existence.

## 10. Build + test plan (combined) and git cadence

**Definition of done for every feature** (no exceptions):
1. Service implementation + route handler + UI (where applicable).
2. **Unit tests** for pure logic (permissions, schedules, state transitions, validation).
3. **Integration tests** against PGlite through the route handler: happy path, validation errors,
   unauthenticated (401), **another circle's user (404)**, insufficient role (403).
4. `npm run lint && npm run typecheck && npm test` green locally; CI green after push.
5. Docs updated (feature status table below).

**Git cadence (many small pushes & merges):**
- One branch per feature: `feat/m<N>-<feature>` (e.g. `feat/m2-invitations`).
- Commit at each green step (schema → service+unit tests → route+integration tests → UI).
- Push the feature branch after each commit.
- When the feature is green: `git merge --no-ff` into `main`, push `main`.
- Every push goes to **both** repositories (`origin` = SRBaggari/CareNest, `peer` = manishreddy1767/CareNest)
  as fast-forward-only pushes — never force. (Automatic Actions-based sync can replace this later.)
- Tag each milestone: `m0`, `m1`, …

## 11. Roadmap

| Milestone | Dates (2026) | Scope | Status |
|---|---|---|---|
| M0 Foundation | Oct 31 – Nov 2 | Next.js scaffold, Drizzle + PGlite/Postgres, migrations, Vitest unit+integration harness, i18n, CI, health endpoint | ✅ done (tag `m0`) |
| M1 Auth | Nov 2 – 5 | Register, login, logout, sessions, rate limiting, Origin checks, account page | ✅ done (tag `m1`) |
| M2 Care circles | Nov 1 – 9 | Circles, care profile, memberships, invitations, permission engine, consent, audit log, circle switcher | 🚧 next |
| M3 Medications | Nov 9 – 14 | Medications, schedules (tz/DST), dose generation, confirm/skip/refuse/proxy, unconfirmed, refill counts | planned |
| M4 Notifications | Nov 14 – 18 | Worker + job queue, reminders, escalation, quiet hours, email adapter, delivery tracking | planned |
| M5 Appointments & tasks | Nov 18 – 21 | Appointments with transport/companion, tasks (recurring, overdue escalation) | planned |
| M6 Caregiver & timeline | Nov 21 – 24 | Visits check-in/out, observations, handover, care updates, unified timeline with corrections | planned |
| M7 Emergency | Nov 24 – 27 | Contacts, info card, assistance request, alert sequence, acknowledgments, failure visibility | planned |
| M8 Dashboards & hardening | Nov 27 – Dec 1 | Elder/family/caregiver dashboards, a11y (axe), Playwright journeys A–F, hi/te/ta strings, deploy config, user docs, labeled demo seed | planned |

## 12. Known limitations (MVP)

- CareNest is **not** an emergency service and does not contact emergency services; it shows the local
  number to call and notifies family.
- Email delivery depends on a configured SMTP provider; without one, emails are logged in dev only.
- No push/SMS channels until Tier 2, so time-critical alerts rely on in-app + email.
- Check-in records are self-reported; they do not verify physical presence.
- Clinician role is an access level only; professional credentials are **not** verified.
- No regulatory compliance (HIPAA, GDPR, DPDP Act 2023) is claimed; an assessment is required before
  production use with real patient data.
