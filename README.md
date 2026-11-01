# CareNest

Coordinate care for aging parents with your family — medicines, appointments, caregiver visits,
tasks and emergency contacts in one shared, privacy-respecting place.

> **CareNest is not an emergency service.** In an emergency, call your local emergency number.

Status: **MVP in development** (target 2026-12-01). See [docs/PLAN.md](docs/PLAN.md) for the product
plan, architecture, permission model and roadmap with per-milestone status.

## Quick start

Requirements: Node.js 22+ (24 recommended). No database server needed for development.

```bash
npm install
npm run dev          # http://localhost:3000 — embedded Postgres (PGlite) in .data/, auto-migrated
```

Check it is up: `http://localhost:3000/api/health` → `{"status":"ok","database":"ok"}`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next route types, then `tsc --noEmit` |
| `npm test` | All tests (unit + integration) |
| `npm run test:unit` | Unit tests (`src/**/*.test.ts`) |
| `npm run test:integration` | Integration tests against an in-memory Postgres (`tests/integration`) |
| `npm run check` | lint + typecheck + all tests — run before every merge |
| `npm run db:generate` | Generate a SQL migration from schema changes |
| `npm run db:migrate` | Apply migrations (to `DATABASE_URL`, or local PGlite) |

## Project layout

```
src/app/            Next.js routes (pages + /api/v1 route handlers — thin)
src/server/         Business logic: services, auth, db (all authorization lives here)
src/i18n/           Translations (en, hi, te, ta complete; hi/te/ta awaiting native-speaker review)
drizzle/            Generated SQL migrations (committed)
tests/integration/  Route-handler + database tests (each file gets its own fresh database)
docs/               Plan, architecture, decisions
```

## Testing

| Command | What it runs |
|---|---|
| `npm test` | Unit + integration tests (embedded PostgreSQL) |
| `npm run test:postgres` | The integration suite on a **real PostgreSQL** server (started automatically) |
| `npm run test:coverage` | With a coverage report in `coverage/` |
| `BLACKBOX_URL=http://localhost:3000 npm run test:blackbox` | Black-box HTTP suite against a running server |
| `npm run build && npm run test:e2e` | Browser tests in Chromium: the main journeys on desktop and phone, and an axe WCAG 2.1 AA scan of every main screen (first run: `npx playwright install chromium`) |

See [docs/TEST-REPORT.md](docs/TEST-REPORT.md) for the latest white-box and black-box results.

## Demo

```bash
npm run build && PGLITE_DATA_DIR=.data/demo CRON_SECRET=demo INSECURE_COOKIES=true npm start
DEMO_URL=http://localhost:3000 CRON_SECRET=demo npm run demo:seed   # in another terminal
```

Sign in as `priya@demo.carenest` (or ravi, meena, amma, dr.iyer, neighbour) with `carenest demo 2026`.

## Production

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**: Docker Compose or any Node host with PostgreSQL,
the required background worker, configuration, security checklist, backups and upgrades.

## License

MIT — see [LICENSE](LICENSE).
