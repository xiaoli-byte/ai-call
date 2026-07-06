import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaskStatus } from '@ai-call/shared';
import { OutboxWorker } from './outbox.worker.js';

type Call = [string, any, any?];

describe('OutboxWorker', () => {
  it('keeps polling available after a batch-level database failure', async () => {
    let recoverAttempts = 0;
    const prisma = {
      outboxEvent: {
        updateMany: async () => {
          recoverAttempts += 1;
          throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        },
        findMany: async () => {
          throw new Error('findMany should not run after recovery failed');
        },
      },
    };

    const worker = new OutboxWorker(prisma as never, {} as never, {} as never);
    const logs: string[] = [];
    (worker as unknown as { logger: { error(message: string): void } }).logger = {
      error: (message: string) => logs.push(message),
    };

    await worker.processBatch();
    await worker.processBatch();

    assert.equal(recoverAttempts, 2);
    assert.deepEqual(logs, [
      'outbox 批处理失败：connect ECONNREFUSED 127.0.0.1:5432',
      'outbox 批处理失败：connect ECONNREFUSED 127.0.0.1:5432',
    ]);
  });

  it('delivers dispatch requests and records accepted events', async () => {
    const calls: Call[] = [];
    const prisma = {
      $transaction: async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[]),
      callAttempt: {
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
    };
    const freeswitch = {
      originate: async (to: string, attemptId: string) => {
        calls.push(['freeswitch.originate', to, attemptId]);
      },
    };

    const worker = new OutboxWorker(prisma as never, freeswitch as never, {} as never);
    await (worker as unknown as { deliver(event: unknown): Promise<void> }).deliver({
      id: 'event-1',
      aggregateId: 'attempt-1',
      type: 'call.dispatch_requested',
      attempts: 0,
      deduplicationKey: 'dispatch-1',
      payload: {
        taskId: 'task-1',
        attemptId: 'attempt-1',
        to: '+1001',
        from: '+1000',
      },
    });

    assert.deepEqual(calls[0], ['freeswitch.originate', '+1001', 'attempt-1']);
    assert.deepEqual(calls[1], ['callAttempt.update', {
      where: { id: 'attempt-1' },
      data: { status: TaskStatus.CALLING, ringingAt: calls[1][1].data.ringingAt },
    }]);
    assert.equal(calls[2][0], 'callEvent.create');
    assert.equal(calls[2][1].data.type, 'call.dispatch_accepted');
    assert.deepEqual(calls[2][1].data.payload, {});
  });

  it('routes sms action payloads through ActionDeliveryService', async () => {
    const calls: Call[] = [];
    const prisma = {
      callEvent: {
        create: async (args: unknown) => {
          calls.push(['callEvent.create', args]);
          return args;
        },
      },
    };
    const actions = {
      deliverSms: async (payload: unknown, idempotencyKey: string) => {
        calls.push(['deliverSms', payload, idempotencyKey]);
      },
    };

    const worker = new OutboxWorker(prisma as never, {} as never, actions as never);
    await (worker as unknown as { deliver(event: unknown): Promise<void> }).deliver({
      id: 'event-2',
      aggregateId: 'attempt-1',
      type: 'action.sms',
      attempts: 0,
      deduplicationKey: 'sms-1',
      payload: {
        taskId: 'task-1',
        attemptId: 'attempt-1',
        to: '+1001',
        config: { template: 'welcome' },
      },
    });

    assert.deepEqual(calls[0], ['deliverSms', {
      taskId: 'task-1',
      attemptId: 'attempt-1',
      to: '+1001',
      config: { template: 'welcome' },
    }, 'sms-1']);
    assert.equal(calls[1][1].data.type, 'action.sms.delivered');
  });
});
