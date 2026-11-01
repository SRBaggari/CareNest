# CareNest — White-box and Black-box Test Report

**Scope:** milestones M0–M7 (accounts, care circles and permissions, medicines, notifications,
appointments and tasks, visits/updates/timeline, emergency assistance).
**Date:** 2026-10-31 to 2026-11-01. **Build tested:** production build (`next build` / `next start`).

## Summary

| | Result |
|---|---|
| Automated tests (unit + integration) | **438 passing**, 0 failing |
| Black-box HTTP suite (`npm run test:blackbox`) | **20 / 20 passing** against a production build |
| Independent black-box exploratory testing | ~95 checks in round 1; round 2 was interrupted (see Limitations) |
| Statement / branch coverage | **90.4% / 86.4%** (was 87.5% / 82.3% before this round) |
| Defects found | **10** (1 critical, 3 medium, 6 low); **8 fixed**, 2 accepted by design |

The most important finding was a **critical denial-of-service**: one ordinary request could make the
server loop forever and run out of memory, taking the app down for every family. It is fixed,
covered by unit, integration and black-box regression tests, and re-verified on a production build.

## 1. White-box testing (code-level)

**Method.** Coverage measured with V8 over all code that holds logic (services, authorization, the
worker, domain rules, API route handlers). Every uncovered branch in the safety-critical services
was reviewed by reading the code, and targeted tests were written for paths that matter.

| | Before | After |
|---|---|---|
| Statements | 87.5% | 90.4% |
| Branches | 82.3% | 86.4% |
| Functions | 81.8% | 84.1% |
| Lines | 89.2% | 91.0% |

Branch coverage by area after this round: domain rules 96%, API routes 95%, auth 91%,
notifications 90%, services 88%, worker 87%.

**New white-box tests** (`tests/integration/whitebox-branches.test.ts`,
`src/server/auth/request.production.test.ts`):
- sliding session expiry (sessions near expiry are extended, so people are not logged out mid-week)
- production-only cookie hardening (`__Host-` prefix, `Secure`), tested under a production environment
- emergency edge cases: a parent alone in a circle asking for help, double acknowledgement,
  resolving without acknowledgement, acting on closed requests
- invitations: daily rate limit, archived circles, existing members
- medicines: a non-schedule edit must not wipe upcoming doses; stopped as-needed medicines
- tasks: closed tasks, reopen/cancel rules
- a sweep sending a malformed id to all 18 id-taking endpoints

**Defects found by white-box testing**

| # | Severity | Defect | Status |
|---|---|---|---|
| W1 | Medium | `GET /emergency/requests/<malformed id>` returned **500** (database rejected the id) instead of 404 | Fixed |
| W2 | Medium | `POST /tasks/<malformed id>/claim` returned **500** — it queried before validating the id | Fixed |

**Not covered by white-box tests (by design):** browser-only code (`src/lib/api-client.ts`), UI pick-lists,
and the real-PostgreSQL connection branch in `src/server/db/index.ts` (tests use embedded Postgres).
These are exercised by the black-box suite; real PostgreSQL is verified in M8 (deployment).

## 2. Black-box testing (behaviour only, through HTTP)

**Method.** Two independent efforts, both using only the public HTTP interface and the requirements
in `docs/PLAN.md`:
1. **Exploratory testing by an independent tester** that was not allowed to read the source code.
   Techniques: equivalence partitioning and boundary values, negative testing, role/permission
   checks, IDOR probing, CSRF, rate limiting, injection.
2. **A repeatable black-box suite** (`tests/blackbox/`, 20 tests) that runs against any deployment:
   `BLACKBOX_URL=https://… npm run test:blackbox`.

**Defects found by black-box testing**

| # | Severity | Observed | Expected | Status |
|---|---|---|---|---|
| F1 | **Critical** | `GET /doses?date=9999-12-31` with active medicines: no response, server grew to ~4 GB and **crashed**; all users affected | Fast 422 | **Fixed** |
| F2 | Medium | `date=2026-02-30` (impossible date) → **500** | 422 | Fixed |
| F3 | Medium | Registration rate limit bypassed by sending a fake `X-Forwarded-For` header | Limit holds | Fixed |
| F4 | Low | A medicine added in the evening created doses for that morning, already "unconfirmed" (could alert family) | No doses before the medicine existed | Fixed |
| F5 | Low | Re-accepting an already-accepted invitation (same person) returns 200 | — | Accepted: idempotent, grants nothing; another person still gets 403 |
| F6 | Low | `text/plain` request bodies were accepted | 415 | Fixed (CSRF was already blocked by the Origin check) |
| F7 | Low | Unknown `/api/…` paths returned an HTML page | JSON error | Fixed |
| F8 | Low | `PLAN.md` lists `/circles/:id/profile`; profile edits are `PATCH /circles/:id`. Consent endpoint validates the body before the role, so a family member with an invalid body sees 422, not 403 | — | Accepted: documentation corrected; only the request schema is revealed |
| — | Low | 429 responses had no `Retry-After` header | Header present | Fixed |

**Root cause of F1.** The dose generator stepped through days by comparing dates as text. The day
after `9999-12-31` formats as `+010000-01-01`, and `+` sorts before `9`, so the loop never ended.
Fix in depth: dates must be real calendar dates between 1900 and 2200; days are counted numerically;
expansions longer than 400 days are refused.

**Fix for F3.** `X-Forwarded-For` is client-controlled, so it is now honoured only when
`TRUST_PROXY=true` (set this when CareNest runs behind your own reverse proxy). Verified on a
production build: 11 registrations, each with a different forged header → the 11th is refused with
429 and `Retry-After`.

**Protections confirmed by black-box testing (passes)**
- Mutations without CareNest's `Origin` (missing, foreign, `null`, look-alike domains) → 403.
- Login throttling is per account (5 attempts / 15 min) and is not bypassed by forged headers;
  unknown emails get the same generic error (no account enumeration).
- Password rules: 9 characters rejected, 10 accepted, 128 accepted, 129 rejected; common passwords rejected.
- Emails trimmed and case-insensitive; duplicates → 409.
- Invitations: wrong email → 403, signed out → 401, bogus token → 404, tokens never listed.
- Role matrix holds (family, caregiver, clinician, emergency contact each refused admin actions).
- A self-managing parent's privacy choices cannot be overridden by an admin; family lose access to
  medicines when sharing is off while caregivers keep it.
- Another family's circle and every resource id inside it → 404 with no data (IDOR), including
  using one's own circle id with someone else's resource id.
- Optimistic concurrency: stale edits → 409.
- Injection-shaped text is stored and shown as plain text; search treats `%` and quotes literally.
- Security headers present (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`), no `X-Powered-By`.
- Accessibility markup: page language set, skip link present, every input has a label, no images without alt text.

## 3. Regression protection

Every defect above has an automated regression test:
`src/server/domain/schedule.test.ts` (F1, F2), `src/server/auth/request.test.ts` (F3),
`tests/integration/blackbox-regressions.test.ts` (F1, F2, F4, F7), `src/server/http.test.ts` (F6, Retry-After),
`tests/integration/whitebox-branches.test.ts` (W1, W2), and the black-box suite (F1, F2, F6, F7, Retry-After).

## 4. Limitations of this round

- The independent tester's **second round was interrupted** before it finished. Journeys B–F, the
  full IDOR sweep, privacy effects, sessions after logout/password change, injection, redirects,
  headers and accessibility were therefore verified by the repeatable black-box suite and the
  integration tests, not by the independent tester.
- No load or performance testing beyond the denial-of-service finding.
- Accessibility was checked by markup only; an automated audit in a real browser (axe) and
  screen-reader testing are planned with the UI work.
- This round used the embedded database (PGlite). **Update (M8):** the full integration suite (237 tests)
  now also passes on a real PostgreSQL 18 server (`npm run test:postgres`) and runs in CI on every push.

## How to re-run

```bash
npm test                     # unit + integration (embedded Postgres)
npm run test:coverage        # with coverage report in coverage/
npm run build && npm start   # then, in another terminal:
BLACKBOX_URL=http://localhost:3000 npm run test:blackbox
```

## Update, 2026-11-01: browser tests

Playwright now drives the production build in Chromium (`npm run test:e2e`, and a CI job on every push):

| | Result |
|---|---|
| Journeys clicked through on screen | Scenarios A (sign up, create a circle, invite, join), B (parent confirms a dose on the Simple view; the family dashboard shows it), D (missing driver flagged until someone offers), E (parent asks for help; the family sees it first and responds) and F (two parents, two separate circles). A, B and E also run at phone size. Scenario C (visits) is covered by the API and integration suites only. |
| Accessibility | axe finds **no WCAG 2.1 A/AA violations** on the landing, sign-in and register pages, every circle page, home, notifications, account and the Simple view (including its opened-up "No, I didn't" / "How are you" / "I need help" states). |
| Keyboard | The skip link is the first stop on the home page, sign-in and the Simple view. |
| Total | **13 / 13 passing** |

Defects these tests found, both fixed in the same change:

- **Navigation crash (high).** In browsers whose `scrollIntoView` returns a Promise (current Chromium), the
  new circle tab bar's effect returned that Promise; React then failed with "destroy is not a function"
  when leaving a circle page, so links such as "No driver yet…" and "Members" did nothing. The HTTP-level
  black-box suite could not see this because it does not run JavaScript.
- **Missing skip link (low).** The sign-in and register pages had no "Skip to main content" link. All
  pages now share one `SkipLink` component.

### Translations and phone layout (same day)

- Hindi, Telugu and Tamil now translate every one of the 791 strings. Unit tests require this for every
  language, check that every `{placeholder}` survives, and that the account-deletion prompt keeps the
  literal word DELETE that must be typed.
- A new browser test opens every main page at 360 px wide in English, Hindi, Telugu and Tamil and fails if
  anything makes the page scroll sideways. It found four problems, all fixed: the phone header could not fit
  long words (Tamil "வெளியேறு", *sign out*, now lives on the Account page on phones), the medicine count
  tiles and card headings did not wrap, the large "Call 112" button was wider than a phone in Tamil, and
  drop-down fields could not shrink below their longest option.
- **Total browser tests: 21 / 21 passing**, run twice in a row to rule out flakiness.
- Not verified: the quality of the translations themselves. They need a native-speaker review before launch.

## Update, 2026-11-01 (later): Tier 1 completion

- **Security defect found and fixed: visit lists returned other families' visits (critical).**
  `listVisits` combined the circle filter with a raw SQL `x or y` fragment that the query builder does
  not bracket, so it read as `(this circle and x) or y`. Every in-progress visit (and, on the Visits
  page's "recent" list, every completed or cancelled visit with its notes) from all circles appeared
  to anyone who could see visits. Present since M6. No deployment exists, so no real data was exposed.
  It was found by the new Scenario C browser test: running the same test several times in parallel
  put two families' visits in one database, which no earlier test had done. Fixed, with a two-family
  regression test (fails on the old code) and a guard test that rejects any raw SQL fragment with an
  unbracketed OR anywhere in the server code.
- Scenario C (caregiver arrives and finishes on their phone; the family dashboard shows the visit and the
  handover note; the summary notification arrives) is now clicked through in the browser, on desktop and
  phone. **All main scenarios A–F now have browser tests: 23 / 23 passing.**
- Lesson: tests that create one family per database can't catch leaks between families. New tests for
  lists now set up a second family alongside.

## Update, 2026-11-01: T2-1 phone alerts (web push)

- Unit and integration tests (fake push service) cover saving and removing devices (own devices only,
  sign-in required, at most 10), the allowlist of push services (requests to any other address, such as
  a cloud metadata IP or a look-alike host, are refused: server-side request forgery), what is sent
  (title only and "Open CareNest to see details", in each person's language; low-priority news never
  buzzes), quiet hours (held until they end, except a request for help, which goes first and stays on
  screen), retries after temporary failures, forgetting devices the push service reports as gone, no
  alerts to anyone outside the circle, and export and deletion with the account. Payloads are erased once
  delivered.
- **Verified for real, not only with fakes:** in a full Chromium browser, the Account page turned alerts
  on through Google's push service, the server signed and encrypted a test alert with its own keys, Google
  accepted it, and the browser's service worker displayed "CareNest test alert – Alerts are working on
  this device". Two things only this real test found: open-source Chromium uses Google's
  `jmt17.google.com` push address (now allowed), and Chrome has no push in private windows (the page now
  says so instead of a generic error).
- Not verified on physical phones (Android Chrome, iPhone Safari) yet.

## Update, 2026-11-01: T2-3 health readings, and a privacy fix

- **Privacy defect found and fixed (high): the circle export and the activity log ignored the parent's
  sharing choices.** An admin could download, through "Download this circle's records", the medicines,
  appointments, health and mood notes and visit notes the person receiving care had chosen not to share
  with them; the activity log (on screen and in the export) also showed entries such as "added the
  medicine Metformin". Both now follow the same rules as the screens; the export lists what was withheld
  and why, and the parent still sees their full activity log. Found while adding readings to the export.
  Tests cover both, with sharing on and off.
- Health readings: 6 unit tests for units, conversions and plausibility ranges (a very high but plausible
  reading is always recorded, never refused), 6 integration tests (units, self vs. someone else, typing
  mistakes, the parent's health-sharing choice for seeing and recording, outsiders and signed-out
  requests, removal by the recorder or an admin with an activity-log entry, daily check-ins), a browser
  journey (a caregiver records blood pressure on a phone; the family sees the latest reading and the
  chart), and the Health page in the accessibility scan and in the phone-layout check in all four
  languages. Chart colours were checked with the data-visualisation palette validator (lightness, chroma,
  colour-blind separation, contrast) in light and dark mode.

## Update, 2026-11-01: T2-4 health documents

- 4 unit tests: the real file type is read from the first bytes (PDF, JPEG, PNG, WebP), so a program,
  HTML page, SVG or zip renamed to `.pdf` is refused; download names are cleaned of paths and quotes and
  keep Telugu/Tamil/Hindi characters (with a plain fallback for old browsers).
- 6 integration tests (in-memory file store): upload and download with safe headers (type checked at
  upload, `nosniff`, `no-store`, a sandboxing Content-Security-Policy), versions, who opened what, refusal
  of fake and oversized files and non-multipart requests, the parent's health-sharing choice (seeing,
  opening, adding, and the activity log), outsiders and signed-out requests, two families on one server,
  and removal deleting the files.
- Browser: a caregiver photographs a prescription on a phone, the family opens it, and the document shows
  who looked. The Documents page is in the accessibility scan and the phone-layout check in four languages.
- Checked in full Chromium: an uploaded PDF still displays inline in the browser's PDF viewer with the
  sandbox header in place.

## Update, 2026-11-01: T2-5 circle messages

- 7 integration tests: starting and replying, unread markers (never for your own messages), alerts for the
  people chosen and quiet news for others in the conversation (email never contains the message),
  refusing to alert people who can't read the conversation without leaving an empty conversation behind,
  one conversation per appointment that follows the appointment-sharing choice, closed to emergency
  contacts, outsiders and signed-out visitors, two families on one server, authors removing only their
  own messages, and conversations in both data exports.
- Browser: a family member asks the caregiver something and ticks her name; on her phone she sees it as
  new, opens it and replies; the family member sees the reply. Messages is in the accessibility scan and
  the phone-layout check in four languages; the black-box isolation sweep now includes a conversation.

