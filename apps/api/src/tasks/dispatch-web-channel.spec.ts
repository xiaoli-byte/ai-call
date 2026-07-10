import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Scenario, TaskStatus } from '@ai-call/shared';
import { TasksService } from './tasks.service.js';
import { DispatchTaskDto } from './dto/dispatch-task.dto.js';

type Call = [string, any];

const scenarios = {
  resolveConfig: async () => undefined,
  get: async () => undefined,
  mergeDefaultVariables: (_config: unknown, variables: Record<string, string>) => variables,
  toDomain: (record: unknown) => record,
};

function taskRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-10T00:00:00.000Z');
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

function buildDispatchMocks(): { prisma: any; calls: Call[] } {
  const calls: Call[] = [];
  const prisma: any = {
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
  };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<void>) => fn(prisma);
  return { prisma, calls };
}

describe('dispatch web channel', () => {
  it('channel=web creates an attempt, marks the task CALLING, skips outbox and records dispatch_accepted', async () => {
    const { prisma, calls } = buildDispatchMocks();
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    const result = await service.dispatch('task-1', 'web');

    assert.equal(calls[0][0], 'outboundTask.updateMany');
    assert.deepEqual(calls[0][1], {
      where: { id: 'task-1', status: TaskStatus.PENDING },
      data: { status: TaskStatus.CALLING, attemptCount: { increment: 1 } },
    });

    assert.equal(calls[1][0], 'callAttempt.create');
    assert.equal(calls[1][1].data.status, TaskStatus.CALLING);
    assert.ok(calls[1][1].data.ringingAt instanceof Date);
    const attemptId = calls[1][1].data.id;

    assert.equal(calls[2][0], 'callEvent.create');
    assert.equal(calls[2][1].data.type, 'call.dispatch_accepted');
    assert.deepEqual(calls[2][1].data.payload, { channel: 'web' });

    // No outbox event should be written for the web channel.
    assert.equal(calls.some(([name]) => name === 'outboxEvent.create'), false);
    assert.equal(calls.filter(([name]) => name === 'callEvent.create').length, 1);

    assert.equal(result.taskId, 'task-1');
    assert.equal(result.attemptId, attemptId);
    assert.equal(result.status, TaskStatus.CALLING);
  });

  it('channel default (freeswitch) keeps the existing behaviour: writes outbox call.dispatch_requested', async () => {
    const { prisma, calls } = buildDispatchMocks();
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    const resultDefault = await service.dispatch('task-1');
    assert.equal(calls[2][1].data.type, 'call.dispatch_requested');
    assert.equal(calls[3][0], 'outboxEvent.create');
    assert.equal(calls[3][1].data.type, 'call.dispatch_requested');
    assert.equal(resultDefault.attemptId, calls[1][1].data.id);
    assert.equal(resultDefault.taskId, 'task-1');

    // Explicit channel: 'freeswitch' must behave identically to the default.
    const { prisma: prismaExplicit, calls: callsExplicit } = buildDispatchMocks();
    const serviceExplicit = new TasksService(prismaExplicit as never, {} as never, scenarios as never, {} as never);

    await serviceExplicit.dispatch('task-1', 'freeswitch');
    assert.equal(callsExplicit[2][1].data.type, 'call.dispatch_requested');
    assert.equal(callsExplicit[3][0], 'outboxEvent.create');
  });

  it('rejects an invalid channel value (DTO validation → 400 via ValidationPipe)', async () => {
    const invalid = plainToInstance(DispatchTaskDto, { channel: 'sip-trunk' });
    const errors = await validate(invalid);
    assert.ok(errors.length > 0);

    for (const value of [undefined, 'freeswitch', 'web']) {
      const valid = plainToInstance(DispatchTaskDto, value === undefined ? {} : { channel: value });
      const validErrors = await validate(valid);
      assert.deepEqual(validErrors, []);
    }
  });
});
