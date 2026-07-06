import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Scenario, TaskPriority, TaskStatus } from '@ai-call/shared';
import { TasksService } from './tasks.service.js';

type Call = [string, any];

const now = new Date('2026-07-02T00:00:00.000Z');

const scenarios = {
  resolveConfig: async () => undefined,
  get: async () => undefined,
  mergeDefaultVariables: (_config: unknown, variables: Record<string, string>) => variables,
  toDomain: (record: unknown) => record,
};

function taskRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    to: '+1001',
    from: '+1000',
    scenario: Scenario.ECOMMERCE,
    variables: {},
    status: TaskStatus.PENDING,
    scheduledAt: now,
    calledAt: null,
    endedAt: null,
    duration: null,
    outcome: null,
    recordingUrl: null,
    intentTags: [],
    attemptCount: 0,
    flowId: null,
    flowVersionId: null,
    flowVersion: null,
    transcripts: [],
    attempts: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('TasksService', () => {
  it('createBatch creates tasks from list rows in priority order', async () => {
    const calls: Array<Record<string, any>> = [];
    const prisma = {
      outboundTask: {
        create: async (args: any) => {
          calls.push(args.data);
          return taskRecord({
            id: `task-${calls.length}`,
            to: args.data.to,
            scenario: args.data.scenario,
            variables: args.data.variables,
            scheduledAt: args.data.scheduledAt,
          });
        },
      },
    };
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    const result = await service.createBatch({
      scenario: Scenario.ECOMMERCE,
      scheduledAt: '2026-07-02T00:00:00.000Z',
      priority: TaskPriority.NORMAL,
      items: [
        { to: '1002', priority: TaskPriority.LOW, variables: { customerName: '李四' } },
        { to: '1001', priority: TaskPriority.HIGH, variables: { customerName: '张三' } },
      ],
    });

    assert.equal(result.createdCount, 2);
    assert.equal(calls[0].to, '1001');
    assert.equal(calls[0].variables.customerName, '张三');
    assert.equal(calls[0].variables.taskPriority, TaskPriority.HIGH);
    assert.equal(result.tasks[0].priority, TaskPriority.HIGH);
    assert.equal(calls[1].to, '1002');
  });

  it('dispatch creates a CallAttempt and idempotent outbox event', async () => {
    const calls: Call[] = [];
    const prisma = {
      outboundTask: {
        findUnique: async () => taskRecord(),
        update: async (args: unknown) => {
          calls.push(['outboundTask.update', args]);
          return { attemptCount: 1 };
        },
      },
      callAttempt: {
        create: async (args: unknown) => {
          calls.push(['callAttempt.create', args]);
          return args;
        },
      },
      callEvent: {
        create: async (args: unknown) => {
          calls.push(['callEvent.create', args]);
          return args;
        },
      },
      outboxEvent: {
        create: async (args: unknown) => {
          calls.push(['outboxEvent.create', args]);
          return args;
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
    };
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    await service.dispatch('task-1');

    assert.equal(calls[0][0], 'outboundTask.update');
    assert.deepEqual(calls[0][1], {
      where: { id: 'task-1' },
      data: { status: TaskStatus.CALLING, attemptCount: { increment: 1 } },
    });
    assert.equal(calls[1][0], 'callAttempt.create');
    assert.equal(calls[1][1].data.taskId, 'task-1');
    assert.equal(calls[1][1].data.attemptNo, 1);
    assert.equal(calls[1][1].data.providerCallId, calls[1][1].data.id);
    assert.equal(calls[2][1].data.type, 'call.dispatch_requested');
    assert.deepEqual(calls[2][1].data.payload, {});
    assert.equal(calls[3][1].data.type, 'call.dispatch_requested');
    assert.equal(calls[3][1].data.aggregateType, 'CallAttempt');
    assert.deepEqual(calls[3][1].data.payload, {
      taskId: 'task-1',
      attemptId: calls[1][1].data.id,
      to: '+1001',
      from: '+1000',
    });
  });

  it('dispatchDuePending dispatches due pending tasks through the normal path', async () => {
    const calls: Call[] = [];
    const prisma = {
      outboundTask: {
        findMany: async () => [{ id: 'task-1' }],
        findUnique: async () => taskRecord(),
        update: async (args: unknown) => {
          calls.push(['outboundTask.update', args]);
          return { attemptCount: 1 };
        },
      },
      callAttempt: {
        create: async (args: unknown) => {
          calls.push(['callAttempt.create', args]);
          return args;
        },
      },
      callEvent: {
        create: async (args: unknown) => {
          calls.push(['callEvent.create', args]);
          return args;
        },
      },
      outboxEvent: {
        create: async (args: unknown) => {
          calls.push(['outboxEvent.create', args]);
          return args;
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
    };
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    const result = await service.dispatchDuePending(5);

    assert.deepEqual(result, { scanned: 1, dispatched: 1 });
    assert.equal(calls[0][0], 'outboundTask.update');
    assert.equal(calls[3][1].data.type, 'call.dispatch_requested');
  });

  it('create rejects tasks blocked by outbound policy before persisting', async () => {
    const calls: Call[] = [];
    const prisma = {
      outboundTask: {
        count: async () => 0,
        create: async (args: unknown) => {
          calls.push(['outboundTask.create', args]);
          return taskRecord();
        },
      },
    };
    const globalConfig = {
      evaluateOutboundPolicy: async () => ({
        allowed: false,
        code: 'blocked_number',
        message: '号码 1001 命中全局黑名单',
      }),
    };
    const service = new TasksService(
      prisma as never,
      {} as never,
      scenarios as never,
      {} as never,
      globalConfig as never,
    );

    await assert.rejects(
      () => service.create({ to: '1001', scenario: Scenario.ECOMMERCE }),
      (err: any) => err.response?.code === 'blocked_number',
    );
    assert.equal(calls.length, 0);
  });

  it('dispatch records a policy blocked event and does not create an outbox event', async () => {
    const calls: Call[] = [];
    const prisma = {
      outboundTask: {
        findUnique: async () => taskRecord(),
        count: async () => 3,
        update: async (args: unknown) => {
          calls.push(['outboundTask.update', args]);
          return { attemptCount: 1 };
        },
      },
      callEvent: {
        create: async (args: unknown) => {
          calls.push(['callEvent.create', args]);
          return args;
        },
      },
      callAttempt: {
        create: async (args: unknown) => {
          calls.push(['callAttempt.create', args]);
          return args;
        },
      },
      outboxEvent: {
        create: async (args: unknown) => {
          calls.push(['outboxEvent.create', args]);
          return args;
        },
      },
    };
    const globalConfig = {
      evaluateOutboundPolicy: async () => ({
        allowed: false,
        code: 'daily_limit_reached',
        message: '号码 1001 已达到当天 3 次外呼上限',
        details: { dailyCallCount: 3, dailyCallLimit: 3 },
      }),
    };
    const service = new TasksService(
      prisma as never,
      {} as never,
      scenarios as never,
      {} as never,
      globalConfig as never,
    );

    await assert.rejects(
      () => service.dispatch('task-1'),
      (err: any) => err.response?.code === 'daily_limit_reached',
    );
    assert.equal(calls[0][0], 'callEvent.create');
    assert.equal(calls[0][1].data.type, 'call.policy_blocked');
    assert.equal(calls.some(([name]) => name === 'outboxEvent.create'), false);
  });

  it('hangup kills the active FreeSWITCH channel and records completion', async () => {
    const calls: Call[] = [];
    const prisma = {
      outboundTask: {
        findUnique: async (args: any) => {
          if (args.where.id === 'attempt-1') return null;
          return taskRecord({
            status: TaskStatus.IN_CALL,
            calledAt: new Date('2026-07-02T00:00:10.000Z'),
            attempts: [],
          });
        },
        update: async (args: unknown) => {
          calls.push(['outboundTask.update', args]);
          return args;
        },
      },
      callAttempt: {
        findFirst: async () => ({
          id: 'attempt-1',
          taskId: 'task-1',
          providerCallId: 'provider-1',
        }),
        findUniqueOrThrow: async () => ({
          id: 'attempt-1',
          answeredAt: new Date('2026-07-02T00:00:20.000Z'),
        }),
        update: async (args: unknown) => {
          calls.push(['callAttempt.update', args]);
          return args;
        },
      },
      callEvent: {
        create: async (args: unknown) => {
          calls.push(['callEvent.create', args]);
          return args;
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
    };
    const freeswitch = {
      hangup: async (channelId: string) => {
        calls.push(['freeswitch.hangup', channelId]);
        return '+OK';
      },
    };
    const service = new TasksService(prisma as never, {} as never, scenarios as never, freeswitch as never);

    await service.hangup('attempt-1');

    assert.deepEqual(calls[0], ['freeswitch.hangup', 'provider-1']);
    assert.equal(calls[1][1].data.status, TaskStatus.COMPLETED);
    assert.equal(calls[2][1].data.status, TaskStatus.COMPLETED);
    assert.equal(calls[3][1].data.type, 'call.hung_up');
    assert.equal(calls[3][1].data.payload.channelId, 'provider-1');
  });
});
