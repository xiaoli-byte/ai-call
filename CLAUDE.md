# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI outbound-call agent (外呼机器人). A pnpm + turbo monorepo mixing **TypeScript** (NestJS control plane + Next.js dashboard) and **Python** (real-time voice agent + FunASR STT server), wired to FreeSWITCH for telephony.

> ⚠️ `README.md` is an aspirational PoC design doc and is partly stale. Trust the code and `docs/architecture-v2.md` over it. Notably: the voice agent is **Python at `services/voice-agent/`** (not TypeScript at `apps/voice-agent/`), there is **no `packages/providers`** package (AI provider abstraction now lives inside the Python voice agent and `packages/shared`), and the API is backed by **PostgreSQL + Prisma** with auth/RBAC and background workers — not the in-memory Maps the README describes.

## Workspace layout

- `apps/api` — NestJS 10 control plane (`@ai-call/api`, port 3001, global prefix `/api`). ESM (`.js` import specifiers in TS source). Prisma + PostgreSQL.
- `apps/dashboard` — Next.js 14 App Router admin UI (`@ai-call/dashboard`, port 3000). Vitest + Radix UI.
- `packages/shared` — `@ai-call/shared`, cross-app types/DTOs/scenario definitions. **Must be built before typechecking apps** (they import its compiled output).
- `services/voice-agent` — Python 3.11 real-time agent (STT→VAD→LLM→tools→TTS loop, WebSocket to FreeSWITCH). pytest.
- `services/funasr-server` — Python FunASR STT service (FastAPI). pytest.
- `freeswitch/` — Docker + local FreeSWITCH configs (dialplan, mod_audio_fork, ESL).
- `contracts/` — JSON Schemas shared across the TS/Python boundary (`task-api.schema.json`, `voice-websocket.schema.json`).
- `docs/architecture-v2.md` — the authoritative current-architecture doc.

## Commands

Run from repo root unless noted. On Windows, npm scripts use PowerShell/`.venv\Scripts\...`; adapt for other shells.

```bash
pnpm install                 # install all workspaces
pnpm dev                     # turbo: run all dev servers
pnpm build                   # turbo: build all
pnpm lint                    # turbo lint — NOTE: "lint" is `tsc --noEmit`, i.e. typecheck (no ESLint)
pnpm test                    # turbo: TS tests (api + dashboard)
pnpm check                   # full gate: shared build + prisma generate + typecheck + all TS & Python tests
```

Per-workspace dev:

```bash
pnpm dev:api                 # NestJS API only
pnpm dev:dashboard           # Next.js dashboard only
pnpm dev:agent-py            # Python voice agent (WebSocket server mode)
pnpm dev:agent-py:cli        # Python voice agent CLI — simulate a conversation in the terminal, no phone/API keys
pnpm dev:funasr              # FunASR STT server
```

Tests (a single test):

```bash
# API (node --test via tsx): filter by file
pnpm --filter @ai-call/api test               # all *.spec.ts under src/
cd apps/api && npx tsx --test src/tasks/outbound-business-flow.spec.ts   # one file

# Dashboard (vitest)
pnpm --filter @ai-call/dashboard test
cd apps/dashboard && npx vitest run __tests__/middleware-public-home.test.ts   # one file
cd apps/dashboard && npx vitest -t "some test name"                            # by name

# Python (pytest, from the service dir with venv active)
cd services/voice-agent && .venv/Scripts/python -m pytest tests -q
cd services/voice-agent && .venv/Scripts/python -m pytest tests/test_agent.py::test_x   # one test
```

Prisma / database (from `apps/api`, or `pnpm --filter @ai-call/api <script>`):

```bash
pnpm --filter @ai-call/api prisma:generate    # regenerate client → apps/api/src/generated/prisma (required after schema changes)
pnpm --filter @ai-call/api prisma:migrate     # migrate dev (local only)
pnpm --filter @ai-call/api prisma:seed        # seed permissions/roles/admin/scenarios/flows/demo tasks (== demo:init)
```

Use `prisma migrate deploy` (never `migrate dev`) in production. `migrate reset` is destructive — only against a disposable local DB (see `docs/testing/operations-loop-regression.md`).

FreeSWITCH: `pnpm freeswitch:up` / `freeswitch:down` (Docker), or `freeswitch:local:*` (Windows PowerShell scripts).

## Architecture

Three planes (see `docs/architecture-v2.md`):

1. **Control plane — NestJS (`apps/api`)**: source of business truth. Owns Postgres, RBAC, task/flow lifecycle. Does **not** touch audio.
2. **Execution plane — Python voice agent (`services/voice-agent`)**: real-time per-call loop. Receives PCM from FreeSWITCH over WebSocket, runs VAD → FunASR STT → RAG → LLM (OpenAI-compatible, tool calls) → TTS, and streams audio back. Calls the API over HTTP for flow context, tools, and status reporting.
3. **Model service — FunASR (`services/funasr-server`)**: independently scalable STT.

### Immutable flow execution (key invariant)

Conversation flows are versioned and immutable. Editing a published `TaskFlow` reverts it to `draft`; publishing snapshots a new `TaskFlowVersion`. A task locks a `flowVersionId` at creation and always executes that snapshot — editing the flow never mutates in-flight tasks. The voice agent fetches the snapshot from the protected `/api/tasks/:id/context`; tasks with no flow fall back to scenario-compatibility mode. Publish is gated by validation (single start node, reachable end node, no dangling edges, branch coverage).

### Durable call lifecycle (outbox pattern)

State transitions and side effects are decoupled via an **outbox**. `outbox_events` are written in the same transaction as task state; a **worker** drains them with exponential backoff (max 5 retries). Background workers have their own entrypoints and are run as separate processes:

- `outbox-worker.main.ts` (`dev:outbox`) — dispatches queued effects (e.g. originate calls).
- `scheduler-worker.main.ts` (`dev:scheduler`) — scheduled/retried work.
- `freeswitch-event-worker.main.ts` (`dev:freeswitch-events`) — ingests FreeSWITCH events.

Durable tables include `outbound_tasks`, `transcript_turns` (idempotent via `Idempotency-Key`), `call_events`, `outbox_events`.

### Auth, tenancy, security

- `JwtAuthGuard` and `PermissionsGuard` are registered **globally** (`APP_GUARD` in `app.module.ts`). Endpoints are authenticated + permission-checked by default; opt out explicitly. Product-module permissions are enforced (see `product-module-permissions.spec.ts`).
- Multi-tenant: `TenantsModule` + `PlatformModule` (organizations, quotas, usage/billing, cost tracking). Prisma schema has ~34 models.
- **Service-to-service tokens**: when `SERVICE_API_TOKEN` is set, internal context/status endpoints require `X-Service-Token`; when `VOICE_AGENT_WS_TOKEN` is set, the voice WebSocket requires a token. `CORS_ORIGINS` is a comma-separated allowlist (never `*` in prod). `INTEGRATION_CONNECTOR_ALLOWLIST` restricts integration targets to `mock://` or whitelisted HTTPS.
- Integration/connector responses must never expose `authConfig`.

### Providers & mock-first

STT/LLM/TTS providers are selected by env var and default to **mock**, so the whole loop runs with **no API keys**. Voice-agent env: `LLM_PROVIDER` (deepseek|qwen|mock|legacy), `TTS_PROVIDER` (qwen|cosyvoice|mock); STT via FunASR. Provider adapters live in `services/voice-agent/src/voice_agent/{llm,tts,stt}.py`.

## Conventions

- **API TypeScript is ESM**: relative imports use `.js` specifiers (e.g. `./tasks.module.js`) even though sources are `.ts`. Match this.
- After any `schema.prisma` change, run `prisma:generate` — the client is generated into `apps/api/src/generated/prisma` (committed/consumed by source).
- `packages/shared` must be built before the API/dashboard typecheck (`pnpm check` does this in order; do the same when running steps manually).
- API tests use Node's built-in test runner via `tsx --test` (`*.spec.ts`); dashboard uses Vitest (`__tests__/*.test.tsx`, `*.test.ts`); Python uses pytest with `asyncio_mode = auto`.
- CI (`.github/workflows/ci.yml`) runs two independent jobs: TypeScript (build shared → prisma generate → typecheck → test → build) and Python (voice-agent + funasr pytest with mock models). Mirror `pnpm check` locally before pushing.
- When changing campaigns / knowledge base / handoffs / integrations / scenario tests / contact history / Prisma migrations, follow `docs/testing/operations-loop-regression.md`.
