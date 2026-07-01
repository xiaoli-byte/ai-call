import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Scenario, TaskStatus } from '@ai-call/shared';
import { TasksService } from './tasks.service.js';

type Call = [string, any];

const now = new Date('2026-07-02T00:00:00.000Z');

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
    const service = new TasksService(prisma as never, {} as never, {} as never);

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
});
