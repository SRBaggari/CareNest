<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## CareNest conventions

- Business rules and **authorization** live in `src/server/services/*` as `(ctx, input)` functions; route
  handlers in `src/app/api/v1` only parse, validate (Zod) and map errors via `handle()` from `src/server/http.ts`.
- Every circle-scoped query filters by `circle_id`. A user who is not a member gets **404**, not 403.
- Inject `now` through the service context; never call `new Date()` inside business logic.
- Every feature ships with unit tests (pure logic, `src/**/*.test.ts`) and integration tests
  (`tests/integration`, using `useTestDb()`), including an unauthenticated case and a cross-circle access case.
- UI strings go in `src/i18n/messages/en.json`; never hard-code user-facing text.
- Schema change → `npm run db:generate` and commit the SQL in `drizzle/`.
- Never claim an integration works (email, emergency, transport) unless it is actually wired and tested.
- Run `npm run check` before merging. Branches: `feat/m<N>-<feature>`, merged into `main` with `--no-ff`.
