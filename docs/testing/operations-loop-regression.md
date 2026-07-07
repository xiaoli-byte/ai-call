# Operations Loop Regression Checklist

Use this checklist before merging changes that touch campaigns, knowledge base, handoffs, integrations, scenario tests, contact history, or Prisma migrations.

## Fast Checks

Run from the repo root:

```powershell
pnpm --filter @ai-call/shared build
pnpm --filter @ai-call/api prisma:generate
pnpm --filter @ai-call/api test:typecheck
pnpm --filter @ai-call/api test
pnpm --filter @ai-call/dashboard test:typecheck
pnpm --filter @ai-call/dashboard test:unit
```

Expected:

- Shared package builds successfully.
- Prisma Client generation succeeds.
- API typecheck exits with code 0.
- API tests pass.
- Dashboard typecheck exits with code 0.
- Dashboard unit tests pass.

## Disposable Local Database Checks

Only run this section against a local database that can be cleared.

Note: these destructive database checks are deliberately excluded from routine CI and should only use a disposable local database.

Run from `apps/api`:

Preflight: confirm `DATABASE_URL` targets a disposable local database and not shared dev, staging, or production.

```powershell
node_modules/.bin/prisma.CMD migrate reset --force
node_modules/.bin/prisma.CMD migrate dev
pnpm prisma:seed
```

Expected:

- Before running `migrate reset --force`, `DATABASE_URL` points to a disposable local database, not shared dev, staging, or production.
- All migrations apply cleanly.
- `migrate dev` reports the schema is already in sync after reset.
- Seed creates permissions, roles, admin user, global config, outbound scenarios, task flows, and demo tasks.

## Manual Smoke

1. Open the dashboard and sign in with the seeded admin user. Seed uses `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`; check the local environment or `apps/api/prisma/seed.ts` for development defaults.
2. Visit `/campaigns`, `/knowledge`, `/scenarios`, `/handoffs`, and `/integrations`.
3. Create a `mock://crm/leads` integration connector and run a test call.
4. Run a scenario test for `collection`.
5. Confirm handoff list loads and callback action does not render a blank page.

## Critical Invariants

- Integration list and create responses must not expose `authConfig`.
- Integration execution must reject non-allowlisted HTTPS hosts and all localhost/private network targets.
- `contact_attempt_history.attempt_id` must be unique.
- Reopening a completed handoff must clear `completed_at`.
- Scenario tests without a knowledge base must be able to pass.
