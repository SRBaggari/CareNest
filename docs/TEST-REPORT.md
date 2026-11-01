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

