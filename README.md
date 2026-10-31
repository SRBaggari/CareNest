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
src/i18n/           Translations (en complete; hi/te/ta partial, fall back to English)
drizzle/            Generated SQL migrations (committed)
tests/integration/  Route-handler + database tests (each file gets its own fresh database)
docs/               Plan, architecture, decisions
```

## Production

Set `DATABASE_URL` to a PostgreSQL 15+ database, run `npm run db:migrate`, then `npm run build && npm start`.
Full deployment guide arrives with milestone M8.

## License

MIT — see [LICENSE](LICENSE).
