import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Scenario, TaskPriority, TaskStatus } from '@ai-call/shared';
import { TasksService } from './tasks.service.js';

type Call = [string, any];

const now = new Date('2026-07-02T00:00:00.000Z');
const ENV_KEYS = [
  'CALL_RECORDING_PUBLIC_BASE_URL',
  'FREESWITCH_SHARED_RECORDINGS_CONTAINER',
  'FREESWITCH_SHARED_RECORDINGS_HOST',
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const scenarios = {
  resolveConfig: async () => undefined,
  get: async () => undefined,
  mergeDefaultVariables: (_config: unknown, variables: Record<string, string>) => variables,
  toDomain: (record: unknown) => record,
};

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

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
        findUniqueOrThrow: async () => ({ attemptCount: 1 }),
        updateMany: async (args: unknown) => {
          calls.push(['outboundTask.updateMany', args]);
          return { count: 1 };
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

    assert.equal(calls[0][0], 'outboundTask.updateMany');
    assert.deepEqual(calls[0][1], {
      where: { id: 'task-1', status: TaskStatus.PENDING },
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
        findUniqueOrThrow: async () => ({ attemptCount: 1 }),
        updateMany: async (args: unknown) => {
          calls.push(['outboundTask.updateMany', args]);
          return { count: 1 };
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
    assert.equal(calls[0][0], 'outboundTask.updateMany');
    assert.equal(calls[3][1].data.type, 'call.dispatch_requested');
  });

  it('dispatch claims the current task status before creating an attempt', async () => {
    const calls: Call[] = [];
    let currentStatus: TaskStatus = TaskStatus.PENDING;
    let attemptCount = 0;
    let taskReads = 0;
    const prisma = {
      outboundTask: {
        findUnique: async (args: any) => {
          if (args.select?.attemptCount) return { attemptCount };
          taskReads += 1;
          return taskRecord({
            status: taskReads <= 2 ? TaskStatus.PENDING : currentStatus,
            attemptCount,
          });
        },
        update: async (args: any) => {
          calls.push(['outboundTask.update', args]);
          currentStatus = args.data.status;
          attemptCount += 1;
          return { attemptCount };
        },
        updateMany: async (args: any) => {
          calls.push(['outboundTask.updateMany', args]);
          if (currentStatus !== args.where.status) return { count: 0 };
          currentStatus = args.data.status;
          attemptCount += 1;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({ attemptCount }),
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

    const results = await Promise.allSettled([
      service.dispatch('task-1'),
      service.dispatch('task-1'),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(calls.filter(([name]) => name === 'callAttempt.create').length, 1);
    assert.equal(calls.filter(([name]) => name === 'outboxEvent.create').length, 1);
    assert.equal(calls.filter(([name]) => name === 'outboundTask.updateMany').length, 2);
  });

  it('enqueueAction accepts CRM actions into the outbox', async () => {
    const calls: Call[] = [];
    const prisma = {
      outboundTask: {
        findUnique: async () => ({ id: 'task-1' }),
        findUniqueOrThrow: async () => ({ to: '+1001' }),
      },
      outboxEvent: {
        findUnique: async () => null,
        create: async (args: unknown) => {
          calls.push(['outboxEvent.create', args]);
          return { id: 'event-1' };
        },
      },
      callEvent: {
        create: async (args: unknown) => {
          calls.push(['callEvent.create', args]);
          return args;
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    };
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    const result = await service.enqueueAction(
      'task-1',
      'crm',
      { action: 'create_after_sale_ticket', priority: 'high' },
      'crm-1',
    );

    assert.deepEqual(result, { accepted: true, eventId: 'event-1' });
    assert.equal(calls[0][1].data.type, 'action.crm');
    assert.equal(calls[0][1].data.deduplicationKey, 'crm-1');
    assert.deepEqual(calls[0][1].data.payload, {
      taskId: 'task-1',
      to: '+1001',
      config: { action: 'create_after_sale_ticket', priority: 'high' },
    });
    assert.equal(calls[1][1].data.type, 'action.crm.requested');
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

  it('records CHANNEL_ANSWER provider events and marks the attempt in call', async () => {
    const calls: Call[] = [];
    const occurredAt = '2026-07-02T00:01:00.000Z';
    const prisma = providerEventPrisma(calls, {
      task: taskRecord({ status: TaskStatus.CALLING, calledAt: null }),
      attempt: attemptRecord({ status: TaskStatus.CALLING }),
    });
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    await service.recordProviderCallEvent({
      provider: 'freeswitch',
      eventType: 'CHANNEL_ANSWER',
      providerCallId: 'provider-1',
      occurredAt,
      raw: { 'Event-Name': 'CHANNEL_ANSWER', 'Unique-ID': 'provider-1' },
    });

    assert.equal(calls[0][0], 'outboundTask.update');
    assert.equal(calls[0][1].data.status, TaskStatus.IN_CALL);
    assert.deepEqual(calls[0][1].data.calledAt, new Date(occurredAt));
    assert.equal(calls[1][0], 'callAttempt.update');
    assert.equal(calls[1][1].data.status, TaskStatus.IN_CALL);
    assert.deepEqual(calls[1][1].data.answeredAt, new Date(occurredAt));
    assert.equal(calls[2][0], 'callEvent.create');
    assert.equal(calls[2][1].data.type, 'call.provider_event');
    assert.equal(calls[2][1].data.taskId, 'task-1');
    assert.equal(calls[2][1].data.attemptId, 'attempt-1');
    assert.equal(calls[2][1].data.payload.eventType, 'CHANNEL_ANSWER');
    assert.equal(calls[2][1].data.payload.providerCallId, 'provider-1');
    assert.deepEqual(calls[2][1].data.payload.raw, {
      'Event-Name': 'CHANNEL_ANSWER',
      'Unique-ID': 'provider-1',
    });
  });

  it('records CHANNEL_HANGUP_COMPLETE by task id and stores no-answer hangup details', async () => {
    const calls: Call[] = [];
    const occurredAt = '2026-07-02T00:02:00.000Z';
    const prisma = providerEventPrisma(calls, {
      task: taskRecord({ status: TaskStatus.CALLING, calledAt: null }),
      attempt: attemptRecord({ status: TaskStatus.CALLING, answeredAt: null }),
    });
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    await service.recordProviderCallEvent({
      provider: 'freeswitch',
      eventType: 'CHANNEL_HANGUP_COMPLETE',
      taskId: 'task-1',
      providerCallId: 'provider-1',
      occurredAt,
      hangupCause: 'NO_ANSWER',
      raw: { 'Hangup-Cause': 'NO_ANSWER' },
    });

    assert.equal(calls[0][0], 'outboundTask.update');
    assert.equal(calls[0][1].data.status, TaskStatus.NO_ANSWER);
    assert.deepEqual(calls[0][1].data.endedAt, new Date(occurredAt));
    assert.equal(calls[1][0], 'callAttempt.update');
    assert.equal(calls[1][1].data.status, TaskStatus.NO_ANSWER);
    assert.equal(calls[1][1].data.hangupCause, 'NO_ANSWER');
    assert.deepEqual(calls[1][1].data.endedAt, new Date(occurredAt));
    assert.equal(calls[2][1].data.payload.hangupCause, 'NO_ANSWER');
  });

  it('records RECORD_STOP events and derives a public recording URL from configured paths', async () => {
    const calls: Call[] = [];
    process.env.CALL_RECORDING_PUBLIC_BASE_URL = 'https://recordings.example.test/calls';
    process.env.FREESWITCH_SHARED_RECORDINGS_CONTAINER = '/var/lib/freeswitch/recordings';
    const prisma = providerEventPrisma(calls, {
      task: taskRecord({ status: TaskStatus.COMPLETED }),
      attempt: attemptRecord({ status: TaskStatus.COMPLETED }),
    });
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    await service.recordProviderCallEvent({
      provider: 'freeswitch',
      eventType: 'RECORD_STOP',
      providerCallId: 'provider-1',
      recordingPath: '/var/lib/freeswitch/recordings/2026/07/attempt-1.wav',
      raw: { 'Record-File-Path': '/var/lib/freeswitch/recordings/2026/07/attempt-1.wav' },
    });

    assert.equal(calls[0][0], 'outboundTask.update');
    assert.equal(
      calls[0][1].data.recordingUrl,
      'https://recordings.example.test/calls/2026/07/attempt-1.wav',
    );
    assert.equal(calls[1][0], 'callAttempt.update');
    assert.equal(
      calls[1][1].data.recordingUrl,
      'https://recordings.example.test/calls/2026/07/attempt-1.wav',
    );
    assert.equal(calls[2][1].data.payload.recordingUrl, 'https://recordings.example.test/calls/2026/07/attempt-1.wav');
  });
});

function attemptRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    taskId: 'task-1',
    attemptNo: 1,
    providerCallId: 'provider-1',
    status: TaskStatus.CALLING,
    startedAt: now,
    ringingAt: now,
    answeredAt: null,
    endedAt: null,
    duration: null,
    hangupCause: null,
    recordingUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function providerEventPrisma(
  calls: Call[],
  records: { task: any; attempt: any },
) {
  const task = { ...records.task };
  const attempt = { ...records.attempt };
  const prisma = {
    outboundTask: {
      findUnique: async (args: any) => {
        if (args.where.id !== task.id) return null;
        if (args.select) {
          return Object.fromEntries(
            Object.keys(args.select).map((key) => [key, task[key]]),
          );
        }
        return { ...task, attempts: [{ ...attempt }], transcripts: [], flowVersion: null };
      },
      update: async (args: any) => {
        calls.push(['outboundTask.update', args]);
        Object.assign(task, args.data);
        return { ...task };
      },
    },
    callAttempt: {
      findFirst: async (args: any) => {
        if (args.where?.taskId === task.id) return { ...attempt };
        const values = args.where?.OR?.flatMap((entry: any) => [entry.id, entry.providerCallId]).filter(Boolean);
        return values?.includes(attempt.id) || values?.includes(attempt.providerCallId)
          ? { ...attempt }
          : null;
      },
      findUniqueOrThrow: async (args: any) => {
        if (args.where.id !== attempt.id) throw new Error(`Attempt not found: ${args.where.id}`);
        return { ...attempt };
      },
      update: async (args: any) => {
        calls.push(['callAttempt.update', args]);
        Object.assign(attempt, args.data);
        return { ...attempt };
      },
    },
    callEvent: {
      create: async (args: any) => {
        calls.push(['callEvent.create', args]);
        return args;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
  };
  return prisma;
}
