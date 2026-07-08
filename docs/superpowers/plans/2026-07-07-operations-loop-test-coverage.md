# Operations Loop Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a protective test suite around the Phase1/Phase2 product modules merged in this session: campaigns, analytics, quality, compliance, knowledge base, handoffs, integrations, scenario tests, dashboard surfaces, and Prisma migration safety.

**Architecture:** Keep fast service-level tests as the main safety net, add reflection tests for controller permissions, add Vitest tests for dashboard API adapters and client action components, and reserve destructive migration checks for a disposable local database. The plan expands coverage without introducing a new browser framework dependency.

**Tech Stack:** NestJS services with `node:test`, Prisma 7, Next.js 14 dashboard, Vitest + jsdom, shared TypeScript package, PowerShell on Windows.

---

## Current Baseline

- Current branch after merge: `main`.
- Existing API test command: `apps/api/node_modules/.bin/tsx.CMD --test "src/**/*.spec.ts"`.
- Existing API coverage includes 92 passing tests across service auth, campaigns, analytics, compliance, knowledge base, quality, handoffs, integrations, scenario tests, tasks, tenants, outbox, and FreeSWITCH.
- Existing dashboard unit test command: `apps/dashboard/node_modules/.bin/vitest.CMD run`.
- Current working tree has unrelated user changes at:
  - `apps/dashboard/vitest.config.ts`
  - `apps/dashboard/__tests__/new-task-main-flow.test.tsx`
  - `freeswitch/conf/autoload_configs/acl.conf.xml`
- Execution agents must inspect and preserve those files before editing. Do not overwrite those user changes.

## Coverage Map

| Area | Existing Coverage | Planned Additional Guard |
| --- | --- | --- |
| Integration center | Mock connector, credential redaction, private endpoint rejection, Basic auth | Wildcard allowlist, blocked endpoint does not call `fetch`, log pagination query shape |
| Contact history | Hangup history upsert by `attemptId`, schema unique constraint | Migration smoke checklist and campaign strategy regression against duplicate history inputs |
| Handoffs | Create from analysis, callback task, reopen clears `completedAt` | Pagination/counts, disposition side effects, callback variables |
| Scenario tests | Golden run, no-knowledge scenario pass | Knowledge-bound low confidence warning, escalation rule warning, expected handoff fail |
| Controller permissions | Internal service endpoint metadata | New product module permission metadata for handoffs, integrations, scenario tests |
| Dashboard API | Type checking only | Endpoint adapter tests for URL/method/body contracts |
| Dashboard actions | Type checking only | Component interaction tests with mocked `apiClient`, `appToast`, and `useRouter` |
| Prisma/migrations | `prisma validate`, local reset already run | Repeatable disposable DB checklist and seed smoke |

---

### Task 1: Add Product Controller Permission Metadata Tests

**Files:**
- Create: `apps/api/src/product-module-permissions.spec.ts`
- Read: `apps/api/src/internal-endpoints.spec.ts`
- Read: `apps/api/src/auth/decorators/permissions.decorator.ts`
- Read: `apps/api/src/handoffs/handoffs.controller.ts`
- Read: `apps/api/src/integrations/integrations.controller.ts`
- Read: `apps/api/src/scenario-tests/scenario-tests.controller.ts`

- [ ] **Step 1: Write the failing metadata test**

Create `apps/api/src/product-module-permissions.spec.ts`:

```ts
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '@ai-call/shared';
import { PERMISSIONS_KEY } from './auth/decorators/permissions.decorator.js';
import { HandoffsController } from './handoffs/handoffs.controller.js';
import { IntegrationsController } from './integrations/integrations.controller.js';
import { ScenarioTestsController } from './scenario-tests/scenario-tests.controller.js';

function permissions(target: object | Function): unknown {
  return Reflect.getMetadata(PERMISSIONS_KEY, target);
}

describe('product module controller permissions', () => {
  it('protects integration reads and writes with separate permissions', () => {
    assert.deepEqual(permissions(IntegrationsController), [PERMISSIONS.TASK_READ]);
    assert.deepEqual(permissions(IntegrationsController.prototype.create), [PERMISSIONS.TASK_UPDATE]);
    assert.deepEqual(permissions(IntegrationsController.prototype.test), [PERMISSIONS.TASK_UPDATE]);
  });

  it('protects handoff reads, updates, callback creation, and analysis creation', () => {
    assert.deepEqual(permissions(HandoffsController), [PERMISSIONS.CALL_READ]);
    assert.deepEqual(permissions(HandoffsController.prototype.createFromAnalysis), [PERMISSIONS.CALL_READ]);
    assert.deepEqual(permissions(HandoffsController.prototype.update), [PERMISSIONS.TASK_UPDATE]);
    assert.deepEqual(permissions(HandoffsController.prototype.createCallback), [PERMISSIONS.TASK_CREATE]);
  });

  it('protects scenario test listing and execution with flow permissions', () => {
    assert.deepEqual(permissions(ScenarioTestsController), [PERMISSIONS.FLOW_READ]);
    assert.deepEqual(permissions(ScenarioTestsController.prototype.run), [PERMISSIONS.FLOW_UPDATE]);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails before the file exists on a clean branch**

Run from `apps/api`:

```powershell
node_modules/.bin/tsx.CMD --test src/product-module-permissions.spec.ts
```

Expected before adding the file: command cannot find or execute the spec. Expected after adding Step 1: tests execute and should pass if current controller metadata is intact.

- [ ] **Step 3: Run all API tests**

Run from `apps/api`:

```powershell
node_modules/.bin/tsx.CMD --test "src/**/*.spec.ts"
```

Expected: all API tests pass, with the test count increased by 3.

- [ ] **Step 4: Commit this focused test**

```powershell
git add apps/api/src/product-module-permissions.spec.ts
git commit -m "test(api): cover product module permissions"
```

---

### Task 2: Extend Integration Connector Security Tests

**Files:**
- Modify: `apps/api/src/integrations/integrations.service.spec.ts`
- Verify existing code: `apps/api/src/integrations/integrations.service.ts`

- [ ] **Step 1: Add wildcard allowlist and blocked fetch tests**

Append these tests inside the existing `describe('IntegrationsService', () => { ... })` block:

```ts
  it('allows wildcard allowlisted HTTPS subdomains', async () => {
    process.env.INTEGRATION_CONNECTOR_ALLOWLIST = '*.example.com';
    const requests: string[] = [];
    globalThis.fetch = async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const prisma = {
      integrationConnector: {
        create: async ({ data }: any) => ({
          id: 'connector-wildcard',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
          updatedAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
      toolCallLog: {
        create: async ({ data }: any) => ({
          id: 'log-wildcard',
          ...data,
          createdAt: new Date('2026-07-07T08:00:01.000Z'),
        }),
      },
    };
    const service = new IntegrationsService(prisma as any);

    const connector = await service.create({
      name: 'Wildcard CRM',
      type: 'crm',
      endpoint: 'https://crm.example.com/hook',
      authType: 'none',
    });
    const result = await service.test(connector.id, { sampleVariables: {} });

    assert.equal(result.status, 'success');
    assert.deepEqual(requests, ['https://crm.example.com/hook']);
  });

  it('does not call fetch when a stored connector endpoint is no longer allowed', async () => {
    process.env.INTEGRATION_CONNECTOR_ALLOWLIST = 'api.example.com';
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response('{}', { status: 200 });
    };
    const prisma = {
      integrationConnector: {
        findUnique: async () => ({
          id: 'connector-unsafe-stored',
          name: 'Stored Unsafe',
          type: 'crm',
          endpoint: 'https://blocked.example.net/hook',
          method: 'POST',
          authType: 'none',
          authConfig: {},
          requestTemplate: {},
          responseMapping: {},
          enabled: true,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
          updatedAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
      toolCallLog: {
        create: async ({ data }: any) => ({
          id: 'log-blocked',
          ...data,
          createdAt: new Date('2026-07-07T08:00:01.000Z'),
        }),
      },
    };
    const service = new IntegrationsService(prisma as any);

    const result = await service.test('connector-unsafe-stored', { sampleVariables: {} });

    assert.equal(result.status, 'failed');
    assert.equal(fetchCalls, 0);
    assert.match(result.errorMessage ?? '', /allowlisted/i);
  });
```

- [ ] **Step 2: Run focused integration tests**

Run from `apps/api`:

```powershell
node_modules/.bin/tsx.CMD --test src/integrations/integrations.service.spec.ts
```

Expected: all `IntegrationsService` tests pass.

- [ ] **Step 3: Run API typecheck**

Run from `apps/api`:

```powershell
node_modules/.bin/tsc.CMD --noEmit
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```powershell
git add apps/api/src/integrations/integrations.service.spec.ts
git commit -m "test(integrations): cover connector endpoint allowlist"
```

---

### Task 3: Extend Handoff Workflow Tests

**Files:**
- Modify: `apps/api/src/handoffs/handoffs.service.spec.ts`
- Verify existing code: `apps/api/src/handoffs/handoffs.service.ts`

- [ ] **Step 1: Add list pagination and counts coverage**

Append inside `describe('HandoffsService', () => { ... })`:

```ts
  it('lists handoffs with status filter, next cursor, and per-status counts', async () => {
    const records = [
      {
        id: 'handoff-2',
        status: 'pending',
        taskId: 'task-2',
        callAttemptId: null,
        callAnalysisId: null,
        campaignId: 'campaign-1',
        phoneNumber: '+8613800138002',
        customerName: '客户B',
        summary: '需要人工确认',
        intent: '人工',
        riskTags: [],
        recommendedAction: '跟进',
        disposition: null,
        notes: null,
        assignedTo: null,
        callbackTaskId: null,
        createdAt: new Date('2026-07-07T08:01:00.000Z'),
        updatedAt: new Date('2026-07-07T08:01:00.000Z'),
        completedAt: null,
      },
      {
        id: 'handoff-1',
        status: 'pending',
        taskId: 'task-1',
        callAttemptId: null,
        callAnalysisId: null,
        campaignId: 'campaign-1',
        phoneNumber: '+8613800138001',
        customerName: '客户A',
        summary: '需要二次外呼',
        intent: '回拨',
        riskTags: ['manual_escalation'],
        recommendedAction: '回拨',
        disposition: null,
        notes: null,
        assignedTo: null,
        callbackTaskId: null,
        createdAt: new Date('2026-07-07T08:00:00.000Z'),
        updatedAt: new Date('2026-07-07T08:00:00.000Z'),
        completedAt: null,
      },
    ];
    const prisma = {
      handoffTicket: {
        findMany: async ({ where, take }: any) => {
          assert.deepEqual(where, { status: 'pending', campaignId: 'campaign-1' });
          assert.equal(take, 2);
          return records;
        },
        count: async ({ where }: any) => {
          const counts: Record<string, number> = {
            pending: 2,
            processing: 1,
            completed: 0,
            closed: 0,
          };
          assert.equal(where.campaignId, 'campaign-1');
          return counts[String(where.status)] ?? 0;
        },
      },
    };
    const service = new HandoffsService(prisma as any, {} as any);

    const page = await service.list({ status: 'pending', campaignId: 'campaign-1', limit: 1 });

    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, 'handoff-2');
    assert.equal(page.nextCursor, 'handoff-2');
    assert.deepEqual(page.counts, {
      pending: 2,
      processing: 1,
      completed: 0,
      closed: 0,
    });
  });
```

- [ ] **Step 2: Add disposition side-effect coverage**

Append inside the same `describe` block:

```ts
  it('applies converted disposition to the source outbound task outcome', async () => {
    const calls: Array<[string, unknown]> = [];
    const ticket: any = {
      id: 'handoff-1',
      status: 'processing',
      taskId: 'task-1',
      callAttemptId: 'attempt-1',
      callAnalysisId: 'analysis-1',
      campaignId: 'campaign-1',
      phoneNumber: '+8613800138000',
      customerName: '客户A',
      summary: '已成交',
      intent: '成交',
      riskTags: [],
      recommendedAction: '记录结果',
      disposition: null,
      notes: null,
      assignedTo: null,
      callbackTaskId: null,
      createdAt: new Date('2026-07-07T08:00:00.000Z'),
      updatedAt: new Date('2026-07-07T08:00:00.000Z'),
      completedAt: null,
    };
    const prisma = {
      handoffTicket: {
        findUnique: async () => ticket,
        update: async ({ data }: any) => ({ ...ticket, ...data }),
      },
      outboundTask: {
        update: async (args: any) => {
          calls.push(['outboundTask.update', args]);
          return args;
        },
      },
    };
    const service = new HandoffsService(prisma as any, {} as any);

    const updated = await service.update('handoff-1', {
      status: 'completed',
      disposition: 'converted',
    });

    assert.equal(updated.status, 'completed');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], {
      where: { id: 'task-1' },
      data: { outcome: CallOutcome.HIGH_INTENT },
    });
  });
```

- [ ] **Step 3: Run focused handoff tests**

Run from `apps/api`:

```powershell
node_modules/.bin/tsx.CMD --test src/handoffs/handoffs.service.spec.ts
```

Expected: all `HandoffsService` tests pass.

- [ ] **Step 4: Commit**

```powershell
git add apps/api/src/handoffs/handoffs.service.spec.ts
git commit -m "test(handoffs): cover list and disposition behavior"
```

---

### Task 4: Extend Scenario Test Risk Evaluation Coverage

**Files:**
- Modify: `apps/api/src/scenario-tests/scenario-tests.service.spec.ts`
- Verify existing code: `apps/api/src/scenario-tests/scenario-tests.service.ts`

- [ ] **Step 1: Add knowledge-bound low confidence warning test**

Append inside `describe('ScenarioTestsService', () => { ... })`:

```ts
  it('warns on low confidence knowledge retrieval only when a scenario binds knowledge', async () => {
    const prisma = {
      scenarioTestRun: {
        create: async ({ data }: any) => ({
          id: 'run-low-confidence',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
    };
    const scenarios = {
      get: async () => ({
        id: 'scenario-collection',
        scenario: 'collection',
        name: '催收',
        greeting: '您好。',
        knowledgeBaseId: 'kb-collection',
        escalationRules: [],
      }),
    };
    const knowledge = {
      retrieve: async () => [
        { id: 'doc-1', source: 'policy.pdf', content: '不相关内容', score: 0.2 },
      ],
    };
    const service = new ScenarioTestsService(prisma as any, scenarios as any, {} as any, knowledge as any);

    const run = await service.run('collection', {
      input: '我想协商延期',
      golden: true,
    });

    assert.equal(run.result, 'warning');
    assert.deepEqual(run.riskItems, ['知识库检索置信度低']);
  });
```

- [ ] **Step 2: Add expected handoff failure test**

Append inside the same `describe` block:

```ts
  it('fails when a golden case expects handoff but the model reply does not mention handoff', async () => {
    const prisma = {
      scenarioTestRun: {
        create: async ({ data }: any) => ({
          id: 'run-missed-handoff',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
    };
    const scenarios = {
      get: async () => ({
        id: 'scenario-collection',
        scenario: 'collection',
        name: '催收',
        greeting: '我可以继续为您说明规则。',
        knowledgeBaseId: undefined,
        escalationRules: [],
      }),
    };
    const service = new ScenarioTestsService(prisma as any, scenarios as any, {} as any, {
      retrieve: async () => [],
    } as any);

    const run = await service.run('collection', {
      input: '我要投诉',
      expectedOutcome: 'handoff',
      golden: true,
    });

    assert.equal(run.result, 'fail');
    assert.deepEqual(run.riskItems, ['未命中预期转人工结果']);
  });
```

- [ ] **Step 3: Run focused scenario tests**

Run from `apps/api`:

```powershell
node_modules/.bin/tsx.CMD --test src/scenario-tests/scenario-tests.service.spec.ts
```

Expected: all `ScenarioTestsService` tests pass.

- [ ] **Step 4: Commit**

```powershell
git add apps/api/src/scenario-tests/scenario-tests.service.spec.ts
git commit -m "test(scenarios): cover risk evaluation branches"
```

---

### Task 5: Add Dashboard API Endpoint Contract Tests

**Files:**
- Create: `apps/dashboard/__tests__/operations-endpoints.test.ts`
- Read: `apps/dashboard/lib/api/types.ts`
- Read: `apps/dashboard/lib/api/endpoints/integrations.ts`
- Read: `apps/dashboard/lib/api/endpoints/handoffs.ts`
- Read: `apps/dashboard/lib/api/endpoints/scenario-tests.ts`

- [ ] **Step 1: Write endpoint contract tests**

Create `apps/dashboard/__tests__/operations-endpoints.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { HttpAdapter, RequestOptions } from '@/lib/api/types';
import { integrationsEndpoints } from '@/lib/api/endpoints/integrations';
import { handoffsEndpoints } from '@/lib/api/endpoints/handoffs';
import { scenarioTestsEndpoints } from '@/lib/api/endpoints/scenario-tests';

function captureAdapter() {
  const calls: Array<{ path: string; options?: RequestOptions }> = [];
  const http: HttpAdapter = {
    async request<T>(path: string, options?: RequestOptions): Promise<T> {
      calls.push({ path, options });
      return { id: 'response-1' } as T;
    },
  };
  return { http, calls };
}

describe('operations API endpoint contracts', () => {
  it('builds integration endpoint requests with stable paths and methods', async () => {
    const { http, calls } = captureAdapter();
    const api = integrationsEndpoints(http);

    await api.create({
      name: 'CRM',
      type: 'crm',
      endpoint: 'mock://crm/leads',
      authType: 'none',
    });
    await api.test('connector-1', { sampleVariables: { phone: '+8613800138000' } });
    await api.logs({ connectorId: 'connector-1', limit: 50, cursor: 'log-1' });

    expect(calls).toEqual([
      {
        path: '/integrations',
        options: {
          method: 'POST',
          body: {
            name: 'CRM',
            type: 'crm',
            endpoint: 'mock://crm/leads',
            authType: 'none',
          },
        },
      },
      {
        path: '/integrations/connector-1/test',
        options: {
          method: 'POST',
          body: { sampleVariables: { phone: '+8613800138000' } },
        },
      },
      {
        path: '/integrations/logs?connectorId=connector-1&limit=50&cursor=log-1',
        options: undefined,
      },
    ]);
  });

  it('builds handoff endpoint requests with stable paths and methods', async () => {
    const { http, calls } = captureAdapter();
    const api = handoffsEndpoints(http);

    await api.list({ status: 'pending', campaignId: 'campaign-1', limit: 25 });
    await api.update('handoff-1', { status: 'completed', disposition: 'converted' });
    await api.createCallbackTask('handoff-1', {
      scheduledAt: '2026-07-07T10:00:00.000Z',
      assignedTo: 'agent-a',
    });
    await api.createFromAnalysis('analysis-1');

    expect(calls).toEqual([
      { path: '/handoffs?status=pending&campaignId=campaign-1&limit=25', options: undefined },
      {
        path: '/handoffs/handoff-1',
        options: { method: 'PATCH', body: { status: 'completed', disposition: 'converted' } },
      },
      {
        path: '/handoffs/handoff-1/callback-task',
        options: {
          method: 'POST',
          body: { scheduledAt: '2026-07-07T10:00:00.000Z', assignedTo: 'agent-a' },
        },
      },
      { path: '/handoffs/from-analysis/analysis-1', options: { method: 'POST' } },
    ]);
  });

  it('builds scenario test endpoint requests with stable paths and methods', async () => {
    const { http, calls } = captureAdapter();
    const api = scenarioTestsEndpoints(http);

    await api.list('collection');
    await api.run('collection', {
      input: '我要投诉',
      expectedOutcome: 'handoff',
      golden: true,
    });

    expect(calls).toEqual([
      { path: '/scenarios/collection/tests', options: undefined },
      {
        path: '/scenarios/collection/tests/run',
        options: {
          method: 'POST',
          body: { input: '我要投诉', expectedOutcome: 'handoff', golden: true },
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run dashboard endpoint tests**

Run from `apps/dashboard`:

```powershell
node_modules/.bin/vitest.CMD run __tests__/operations-endpoints.test.ts
```

Expected: all tests in `operations-endpoints.test.ts` pass.

- [ ] **Step 3: Run dashboard typecheck**

Run from `apps/dashboard`:

```powershell
node_modules/.bin/tsc.CMD --noEmit
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```powershell
git add apps/dashboard/__tests__/operations-endpoints.test.ts
git commit -m "test(dashboard): cover operations endpoint contracts"
```

---

### Task 6: Add Dashboard Client Action Component Smoke Tests

**Files:**
- Create: `apps/dashboard/__tests__/operations-actions.test.tsx`
- Read: `apps/dashboard/app/integrations/IntegrationActions.tsx`
- Read: `apps/dashboard/app/handoffs/HandoffActions.tsx`
- Read: `apps/dashboard/app/knowledge/[id]/KnowledgeActions.tsx`
- Read: `apps/dashboard/app/scenarios/[id]/tests/ScenarioTestRunner.tsx`

- [ ] **Step 1: Write mocked action tests**

Create `apps/dashboard/__tests__/operations-actions.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationActions } from '@/app/integrations/IntegrationActions';

const refresh = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const createIntegration = vi.fn();
const testIntegration = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/toast', () => ({
  appToast: {
    success: toastSuccess,
    error: toastError,
  },
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    integrations: {
      create: createIntegration,
      test: testIntegration,
    },
  },
}));

describe('operations client actions', () => {
  beforeEach(() => {
    refresh.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    createIntegration.mockReset();
    testIntegration.mockReset();
  });

  it('creates an integration connector and refreshes the page', async () => {
    createIntegration.mockResolvedValue({ id: 'connector-1' });

    render(<IntegrationActions />);
    fireEvent.click(screen.getByRole('button', { name: /创建/i }));

    await waitFor(() => {
      expect(createIntegration).toHaveBeenCalledWith({
        name: 'CRM Webhook',
        type: 'crm',
        endpoint: 'mock://crm/leads',
        authType: 'none',
        requestTemplate: {
          phone: '{{phone}}',
          customerName: '{{customerName}}',
          intent: '{{intent}}',
        },
        responseMapping: { externalId: '$.id' },
        enabled: true,
      });
    });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows an error when testing without a connector id', async () => {
    render(<IntegrationActions />);
    fireEvent.click(screen.getByRole('button', { name: /测试/i }));

    expect(testIntegration).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the action tests**

Run from `apps/dashboard`:

```powershell
node_modules/.bin/vitest.CMD run __tests__/operations-actions.test.tsx
```

Expected: tests pass. If Chinese text in rendered buttons is encoded differently in the local file, prefer querying buttons by order with `screen.getAllByRole('button')` and keep assertions on API calls.

- [ ] **Step 3: Add one component per follow-up patch**

After the integration tests pass, add focused tests in the same file for:

- `HandoffActions`: clicking callback creation sends `createCallbackTask(id, { scheduledAt, assignedTo })`.
- `KnowledgeActions`: clicking upload/retrieve invokes the matching knowledge API and refreshes.
- `ScenarioTestRunner`: clicking run sends `scenarioTests.run(scenarioKey, { input, expectedOutcome, golden })`.

Each component should get at least one success-path assertion and one missing-input/error-path assertion.

- [ ] **Step 4: Run dashboard unit suite**

Run from `apps/dashboard`:

```powershell
node_modules/.bin/vitest.CMD run
```

Expected: all dashboard unit tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/dashboard/__tests__/operations-actions.test.tsx
git commit -m "test(dashboard): cover operations action components"
```

---

### Task 7: Add Migration and Seed Safety Checklist

**Files:**
- Create: `docs/testing/operations-loop-regression.md`
- Read: `apps/api/prisma/migrations/20260707010000_phase2_operations_loop/migration.sql`
- Read: `apps/api/prisma/schema.prisma`
- Read: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Create the regression runbook**

Create `docs/testing/operations-loop-regression.md`:

```md
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

Run from `apps/api`:

```powershell
node_modules/.bin/prisma.CMD migrate reset --force
node_modules/.bin/prisma.CMD migrate dev
npm run prisma:seed
```

Expected:

- All migrations apply cleanly.
- `migrate dev` reports the schema is already in sync after reset.
- Seed creates permissions, roles, admin user, global config, outbound scenarios, task flows, and demo tasks.

## Manual Smoke

1. Open the dashboard and sign in with the seeded admin user.
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
```

- [ ] **Step 2: Run markdown-free validation commands from the runbook**

Run from repo root:

```powershell
pnpm --filter @ai-call/shared build
pnpm --filter @ai-call/api prisma:generate
pnpm --filter @ai-call/api test:typecheck
pnpm --filter @ai-call/api test
pnpm --filter @ai-call/dashboard test:typecheck
pnpm --filter @ai-call/dashboard test:unit
```

Expected: all commands exit with code 0.

- [ ] **Step 3: Commit**

```powershell
git add docs/testing/operations-loop-regression.md
git commit -m "docs(testing): document operations regression checks"
```

---

## Definition of Done

- API service tests cover all review-fixed invariants:
  - no credential leak from integrations
  - SSRF guard on create and execute paths
  - Basic auth header generation
  - contact attempt history idempotency
  - handoff `completedAt` clearing
  - knowledge-free scenario pass
- Product module controller permissions are locked by reflection tests.
- Dashboard endpoint contracts are covered by Vitest.
- At least one dashboard client action surface is covered by mocked interaction tests, with follow-up tests for the remaining action components in the same style.
- Migration and seed safety steps are documented in `docs/testing/operations-loop-regression.md`.
- Final verification command set passes:

```powershell
pnpm --filter @ai-call/shared build
pnpm --filter @ai-call/api prisma:generate
pnpm --filter @ai-call/api test:typecheck
pnpm --filter @ai-call/api test
pnpm --filter @ai-call/dashboard test:typecheck
pnpm --filter @ai-call/dashboard test:unit
```

## Self-Review

- Spec coverage: The plan covers API service invariants, controller permissions, dashboard endpoint contracts, dashboard action smoke tests, migration reset/dev, seed, and manual smoke.
- Placeholder scan: The plan contains concrete file paths, commands, and expected outcomes. It avoids open-ended implementation notes.
- Type consistency: Test snippets use existing exported names from `@ai-call/shared`, current controller names, current endpoint factories, and current service class names.

