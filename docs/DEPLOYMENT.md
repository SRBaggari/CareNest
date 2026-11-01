# Deploying CareNest

CareNest is one Node.js application with two processes that share a PostgreSQL database:

| Process | Command | Purpose |
|---|---|---|
| **web** | `npm start` | The website and the `/api/v1` API |
| **worker** | `npm run worker` | Reminders, unconfirmed-dose alerts, emergency escalation, email delivery, data retention (every 30 s) |
| **migrate** | `npm run db:migrate` | Applies database migrations; run on every release, before starting web and worker |

> **The worker is not optional.** Without it, no reminders, alerts, emergency escalations or emails
> are sent. If your host cannot run a second process, call `POST /api/internal/tick` every minute
> from a scheduler with `Authorization: Bearer $CRON_SECRET` instead.

## Option A — Docker Compose (one server)

```bash
cp .env.example .env        # set the values below
docker compose up -d --build
docker compose ps           # db, web, worker running; migrate exited 0
```

This starts PostgreSQL 17, runs migrations, then the web app on port 3000 and the worker.
Put a reverse proxy in front of `web` for HTTPS (Caddy, nginx or a cloud load balancer) and set
`TRUST_PROXY=true`.

**Verified in CI:** every push to `main` builds the image, starts this exact stack and runs the
black-box test suite against it (`.github/workflows/ci.yml`, job `deploy-smoke`). It has not been
run on the developers' machines, which don't have Docker.

## Option B — any Node.js host + managed PostgreSQL

Requirements: Node.js 22+ (24 recommended), PostgreSQL 15+ (tested on 17 in CI and 18 locally).

```bash
npm ci
npm run build
npm run db:migrate          # with DATABASE_URL set
npm start                   # web
npm run worker              # in a second process / service
```

Choose a database region close to your users (for families in India, e.g. Mumbai/`ap-south-1`).

The database must use the **UTF8** character set (CareNest stores Hindi, Telugu and Tamil). Managed
providers and the official Docker image use UTF8 by default; a database created on a Windows or older
Linux server may not. `npm run db:migrate` checks this and stops with instructions if it isn't UTF8.
To create one by hand: `CREATE DATABASE carenest ENCODING 'UTF8' TEMPLATE template0;`

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:password@host:5432/carenest`. Without it CareNest uses the embedded development database — **never in production**. |
| `APP_URL` | yes | Public address, e.g. `https://care.example.org`. Used in invitation and notification links, and accepted as a request origin. |
| `TRUST_PROXY` | behind a proxy | `true` only when a reverse proxy you control sets `X-Forwarded-For`. Otherwise leave unset: the header is client-controlled and would let people dodge rate limits. |
| `SMTP_URL` | for email | e.g. `smtps://user:pass@smtp.provider.com:465`. Without it, no email is sent and the app says so. Not yet verified against a real provider. |
| `EMAIL_FROM` | for email | Sender, e.g. `CareNest <no-reply@care.example.org>` (must be allowed by your provider). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | for phone alerts | Web push keys. Create once with `npx web-push generate-vapid-keys`; keep the private key secret and never change it (changing it silently stops alerts to every device until people turn them on again). Without them, phone alerts are off and the Account page says so. |
| `DOCUMENT_STORAGE_DIR` | no | Folder for uploaded health documents (default `.data/documents`; `/data/documents` in the Docker image, on the `documents` volume). Keep it outside the web root and back it up with the database. |
| `VAPID_SUBJECT` | for phone alerts | A contact the push services can reach, e.g. `mailto:admin@care.example.org`. |
| `CRON_SECRET` | if using the tick endpoint | Long random string. The tick endpoint is disabled (404) when unset. |
| `WORKER_INTERVAL_MS` | no | Worker tick interval, default 30000. |
| `DATABASE_POOL_MAX` | no | Connection pool size per process, default 10. |
| `INSECURE_COOKIES` | never in production | `true` drops the `Secure` cookie flag for plain-HTTP testing only. |

## Security checklist

- [ ] Served only over **HTTPS** (cookies are `Secure` and `__Host-` prefixed in production).
- [ ] `TRUST_PROXY=true` only behind your own proxy; the proxy overwrites `X-Forwarded-For`.
- [ ] `CRON_SECRET` is long and random, or unset if you run the worker process.
- [ ] Database not reachable from the internet; strong password; TLS to the database if remote.
- [ ] Backups configured and a restore tested (below).
- [ ] An email provider configured and tested before relying on email alerts.
- [ ] A legal/privacy assessment for your jurisdiction (e.g. India's DPDP Act 2023, GDPR) before
      storing real health information — CareNest does not claim compliance.

## Backups and recovery

All state is in PostgreSQL, except uploaded health documents (files, see below). Use your provider's automated backups with point-in-time recovery, or:

```bash
# Nightly logical backup (keep at least 30 days; store off the server, encrypted)
pg_dump --format=custom --no-owner "$DATABASE_URL" > carenest-$(date +%F).dump

# Restore into an empty database, then start web and worker
pg_restore --no-owner --dbname "$DATABASE_URL" carenest-2026-11-01.dump
```

**Health documents are files, not database rows**: back up the documents folder (`DOCUMENT_STORAGE_DIR`,
or the `documents` volume with Docker Compose) at the same time as the database, and restore both
together. For example: `docker run --rm -v carenest_documents:/d -v "$PWD":/b alpine tar czf /b/documents-$(date +%F).tgz -C /d .`

Test a restore at least once before going live. After restoring, run `npm run db:migrate` (a no-op
if the backup is from the same release).

## Upgrading

1. Back up the database.
2. Deploy the new release, run `npm run db:migrate`, then restart web and worker.

Migrations only add to the schema in this release series; they are plain SQL in `drizzle/`, so you
can review exactly what each one does.

## Data retention (automatic)

The worker deletes data whose purpose has passed: expired sessions, read notifications older than
180 days, delivered or failed email records older than 30 days (email bodies are already erased on
delivery), and rate-limit counters older than 48 hours. Care records and the activity log are kept
for the life of the circle. People can export their data or delete their account
(`GET /api/v1/me/export`, `DELETE /api/v1/me`); circle managers can export a circle
(`GET /api/v1/circles/:id/export`).

## Health and monitoring

- `GET /api/health` → `{"status":"ok","database":"ok"}` (503 if the database is unreachable).
  The Docker image uses it as its health check.
- The worker logs a JSON summary whenever a tick did work, and logs (without crashing) if a tick fails.
- Watch for: worker not running (no reminders), email `failed` counts, and 5xx responses.
