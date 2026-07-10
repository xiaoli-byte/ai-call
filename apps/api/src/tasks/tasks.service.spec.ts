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
  'PROVIDER_SNAPSHOT_GRACE_MS',
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

  it('FreeSWITCH hangup records the request before uuid_kill and waits for the provider terminal event', async () => {
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
          channel: 'freeswitch',
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
      contactAttemptHistory: {
        upsert: async (args: unknown) => {
          calls.push(['contactAttemptHistory.upsert', args]);
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

    const result = await service.hangup('attempt-1', { outcome: 'high_intent' as never });

    assert.equal(calls[0][0], 'outboundTask.update');
    assert.equal(calls[0][1].data.outcome, 'high_intent');
    assert.equal(calls[1][0], 'callEvent.create');
    assert.equal(calls[1][1].data.type, 'call.hangup_requested');
    assert.equal(calls[1][1].data.payload.channelId, 'provider-1');
    assert.deepEqual(calls[2], ['freeswitch.hangup', 'provider-1']);
    assert.equal(calls.some(([name]) => name === 'callAttempt.update'), false);
    assert.equal(result.status, TaskStatus.IN_CALL);
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
      providerEventId: 'event-answer-1',
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
      providerEventId: 'event-hangup-1',
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

  it('records provider hangup history idempotently by attempt id', async () => {
    const calls: Call[] = [];
    const occurredAt = '2026-07-02T00:02:00.000Z';
    const prisma = providerEventPrisma(calls, {
      task: taskRecord({ status: TaskStatus.CALLING, calledAt: null }),
      attempt: attemptRecord({ status: TaskStatus.CALLING, answeredAt: null }),
    });
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    await service.recordProviderCallEvent({
      provider: 'freeswitch',
      providerEventId: 'event-hangup-history-1',
      eventType: 'CHANNEL_HANGUP_COMPLETE',
      taskId: 'task-1',
      providerCallId: 'provider-1',
      occurredAt,
      hangupCause: 'NO_ANSWER',
    });

    const historyCall = calls.find(([name]) => name === 'contactAttemptHistory.upsert');
    assert.ok(historyCall);
    assert.deepEqual(historyCall[1].where, { attemptId: 'attempt-1' });
    assert.equal(historyCall[1].create.status, TaskStatus.NO_ANSWER);
    assert.equal(calls.some(([name]) => name === 'contactAttemptHistory.create'), false);
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
      providerEventId: 'event-record-1',
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
    channel: 'freeswitch',
    providerCallId: 'provider-1',
    providerJobId: 'job-1',
    status: TaskStatus.CALLING,
    startedAt: now,
    ringingAt: now,
    answeredAt: null,
    endedAt: null,
    duration: null,
    hangupCause: null,
    recordingUrl: null,
    lastProviderEventAt: null,
    lastProviderSnapshotId: null,
    lastProviderSnapshotAt: null,
    missingProviderSnapshotCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function providerEventPrisma(
  calls: Call[],
  records: { task: any; attempt?: any; attempts?: any[] },
) {
  const task = { ...records.task };
  const attempts = (records.attempts ?? [records.attempt]).filter(Boolean).map((attempt) => ({
    ...attempt,
  }));
  task.attemptCount = task.attemptCount || Math.max(...attempts.map((attempt) => attempt.attemptNo), 0);
  const events: any[] = [];
  const prisma = {
    __records: { task, attempts, events },
    outboundTask: {
      findUnique: async (args: any) => {
        if (args.where.id !== task.id) return null;
        if (args.select) {
          return Object.fromEntries(
            Object.keys(args.select).map((key) => [key, task[key]]),
          );
        }
        return { ...task, attempts: attempts.map((attempt) => ({ ...attempt })), transcripts: [], flowVersion: null };
      },
      update: async (args: any) => {
        calls.push(['outboundTask.update', args]);
        Object.assign(task, args.data);
        return { ...task };
      },
    },
    callAttempt: {
      findFirst: async (args: any) => {
        if (args.where?.taskId === task.id) {
          return [...attempts]
            .sort((left, right) => right.attemptNo - left.attemptNo)
            .map((attempt) => ({ ...attempt }))[0] ?? null;
        }
        const values = args.where?.OR?.flatMap((entry: any) => [entry.id, entry.providerCallId]).filter(Boolean);
        const attempt = attempts.find((item) => values?.includes(item.id) || values?.includes(item.providerCallId));
        return attempt ? project(attempt, args.select) : null;
      },
      findUnique: async (args: any) => {
        const attempt = attempts.find((item) =>
          (args.where.id && item.id === args.where.id) ||
          (args.where.providerCallId && item.providerCallId === args.where.providerCallId) ||
          (args.where.providerJobId && item.providerJobId === args.where.providerJobId));
        return attempt ? project(attempt, args.select) : null;
      },
      findUniqueOrThrow: async (args: any) => {
        const attempt = attempts.find((item) => item.id === args.where.id);
        if (!attempt) throw new Error(`Attempt not found: ${args.where.id}`);
        return { ...attempt };
      },
      findMany: async (args: any) => attempts
        .filter((attempt) => {
          if (args.where?.channel && attempt.channel !== args.where.channel) return false;
          if (args.where?.status?.in && !args.where.status.in.includes(attempt.status)) return false;
          return true;
        })
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((attempt) => ({
          ...project(attempt, args.select),
          task: project(task, args.select?.task?.select),
        })),
      update: async (args: any) => {
        const attempt = attempts.find((item) => item.id === args.where.id);
        if (!attempt) throw new Error(`Attempt not found: ${args.where.id}`);
        calls.push(['callAttempt.update', args]);
        Object.assign(attempt, args.data);
        return { ...attempt };
      },
    },
    callEvent: {
      findUnique: async (args: any) => {
        const key = args.where.provider_providerEventId;
        const event = events.find((item) => item.provider === key.provider && item.providerEventId === key.providerEventId);
        return event ? project(event, args.select) : null;
      },
      create: async (args: any) => {
        calls.push(['callEvent.create', args]);
        const event = { id: `event-${events.length + 1}`, ...args.data };
        events.push(event);
        return event;
      },
    },
    contactAttemptHistory: {
      create: async (args: any) => {
        calls.push(['contactAttemptHistory.create', args]);
        return args;
      },
      upsert: async (args: any) => {
        calls.push(['contactAttemptHistory.upsert', args]);
        return args;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
  };
  return prisma;
}

function project(record: Record<string, any>, select?: Record<string, unknown>): any {
  if (!select) return { ...record };
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => key !== 'task')
      .map((key) => [key, record[key]]),
  );
}

/** 最小 ClsService 假实现：只暴露 get(key)，供 CALL-05 ACL 测试注入 userId/roles。 */
function fakeCls(store: Record<string, unknown>) {
  return { get: (key: string) => store[key] };
}

describe('TasksService CALL-05 task ACL', () => {
  it('list() applies owner+grant visibility for a non-bypass user', async () => {
    const calls: Array<[string, any]> = [];
    const prisma = {
      outboundTask: {
        findMany: async (args: any) => {
          calls.push(['outboundTask.findMany', args]);
          return [];
        },
      },
      resourceGrant: {
        findMany: async (args: any) => {
          calls.push(['resourceGrant.findMany', args]);
          return [{ resourceId: 'granted-task', perms: 1 }];
        },
      },
    };
    const cls = fakeCls({ userId: 'u1', roles: ['operator'] });
    const service = new TasksService(
      prisma as never,
      {} as never,
      scenarios as never,
      {} as never,
      undefined,
      cls as never,
    );

    await service.list({});

    const [, grantArgs] = calls.find(([name]) => name === 'resourceGrant.findMany')!;
    assert.equal(grantArgs.where.resourceType, 'call_task');

    const [, listArgs] = calls.find(([name]) => name === 'outboundTask.findMany')!;
    assert.deepEqual(listArgs.where.AND[1], {
      OR: [
        { ownerId: null },
        { ownerId: 'u1' },
        { id: { in: ['granted-task'] } },
      ],
    });
  });

  it('list() skips the ACL query entirely for admin', async () => {
    const calls: Array<[string, any]> = [];
    const prisma = {
      outboundTask: {
        findMany: async (args: any) => {
          calls.push(['outboundTask.findMany', args]);
          return [];
        },
      },
      resourceGrant: {
        findMany: async () => {
          throw new Error('resourceGrant.findMany should not be called for admin');
        },
      },
    };
    const cls = fakeCls({ userId: 'u1', roles: ['admin'] });
    const service = new TasksService(
      prisma as never,
      {} as never,
      scenarios as never,
      {} as never,
      undefined,
      cls as never,
    );

    await service.list({});

    const [, listArgs] = calls[0];
    assert.deepEqual(listArgs.where.AND[1], {});
  });

  it('assertTaskVisible allows the owner and denies a stranger with 404', async () => {
    const task = { id: 'task-1', ownerId: 'owner-1' as string | null };
    const prisma = {
      outboundTask: {
        findUnique: async (args: any) =>
          args.where.id === task.id ? { ownerId: task.ownerId } : null,
      },
      resourceGrant: {
        findFirst: async () => null,
      },
    };

    const ownerCls = fakeCls({ userId: 'owner-1', roles: ['operator'] });
    const ownerService = new TasksService(
      prisma as never,
      {} as never,
      scenarios as never,
      {} as never,
      undefined,
      ownerCls as never,
    );
    await ownerService.assertTaskVisible('task-1'); // does not throw

    const strangerCls = fakeCls({ userId: 'stranger-1', roles: ['operator'] });
    const strangerService = new TasksService(
      prisma as never,
      {} as never,
      scenarios as never,
      {} as never,
      undefined,
      strangerCls as never,
    );
    await assert.rejects(
      () => strangerService.assertTaskVisible('task-1'),
      (err: any) => err?.status === 404 || err?.constructor?.name === 'NotFoundException',
    );
  });

  it('assertTaskVisible allows a stranger with an explicit VIEW grant', async () => {
    const task = { id: 'task-1', ownerId: 'owner-1' as string | null };
    const prisma = {
      outboundTask: {
        findUnique: async (args: any) =>
          args.where.id === task.id ? { ownerId: task.ownerId } : null,
      },
      resourceGrant: {
        findFirst: async (args: any) => {
          assert.equal(args.where.resourceId, 'task-1');
          return { perms: 1 }; // VIEW
        },
      },
    };
    const cls = fakeCls({ userId: 'granted-1', roles: ['operator'] });
    const service = new TasksService(
      prisma as never,
      {} as never,
      scenarios as never,
      {} as never,
      undefined,
      cls as never,
    );
    await service.assertTaskVisible('task-1'); // does not throw
  });

  it('assertTaskVisible allows anyone to see a legacy task with no owner', async () => {
    const task = { id: 'task-1', ownerId: null as string | null };
    const prisma = {
      outboundTask: {
        findUnique: async (args: any) =>
          args.where.id === task.id ? { ownerId: task.ownerId } : null,
      },
      resourceGrant: {
        findFirst: async () => {
          throw new Error('should not need a grant lookup for a legacy task');
        },
      },
    };
    const cls = fakeCls({ userId: 'anyone', roles: ['viewer'] });
    const service = new TasksService(
      prisma as never,
      {} as never,
      scenarios as never,
      {} as never,
      undefined,
      cls as never,
    );
    await service.assertTaskVisible('task-1'); // does not throw
  });
});
