import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaskStatus } from '@ai-call/shared';
import { MetricsService } from '../metrics/metrics.service.js';
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
      outboxEvent: {
        update: async (args: unknown) => {
          calls.push(['outboxEvent.update', args]);
          return args;
        },
      },
      callAttempt: {
        findUnique: async () => ({ providerJobId: null, status: TaskStatus.CALLING }),
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
      originate: async (to: string, attemptId: string, taskId: string) => {
        calls.push(['freeswitch.originate', to, attemptId + ':' + taskId]);
        return {
          accepted: true as const,
          jobId: 'job-1',
          replyText: '+OK Job-UUID: job-1',
        };
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

    assert.deepEqual(calls[0], ['freeswitch.originate', '+1001', 'attempt-1:task-1']);
    assert.deepEqual(calls[1], ['callAttempt.update', {
      where: { id: 'attempt-1' },
      data: { providerJobId: 'job-1' },
    }]);
    assert.equal(calls[2][0], 'callEvent.create');
    assert.equal(calls[2][1].data.type, 'call.dispatch_accepted');
    assert.deepEqual(calls[2][1].data.payload, {
      channel: 'freeswitch',
      provider: 'freeswitch',
      providerJobId: 'job-1',
    });
    assert.equal(calls[3][0], 'outboxEvent.update');
    assert.equal(calls[3][1].data.status, 'processed');
  });

  it('skips re-dialing when a prior delivery already placed the call', async () => {
    const calls: Call[] = [];
    const prisma = {
      $transaction: async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[]),
      outboxEvent: {
        update: async (args: unknown) => {
          calls.push(['outboxEvent.update', args]);
          return args;
        },
      },
      callAttempt: {
        // Already dialed on a prior delivery — providerJobId committed.
        findUnique: async () => ({ providerJobId: 'job-prev', status: TaskStatus.CALLING }),
        update: async (args: unknown) => {
          calls.push(['callAttempt.update', args]);
          return args;
        },
      },
      callEvent: { create: async (args: unknown) => { calls.push(['callEvent.create', args]); return args; } },
    };
    const freeswitch = {
      originate: async () => {
        calls.push(['freeswitch.originate']);
        return { accepted: true as const, jobId: 'job-2', replyText: '+OK' };
      },
    };

    const worker = new OutboxWorker(prisma as never, freeswitch as never, {} as never);
    await (worker as unknown as { deliver(event: unknown): Promise<void> }).deliver({
      id: 'event-1', aggregateId: 'attempt-1', type: 'call.dispatch_requested',
      attempts: 0, deduplicationKey: 'dispatch-1',
      payload: { taskId: 'task-1', attemptId: 'attempt-1', to: '+1001', from: '+1000' },
    });

    // No second real call; only the outbox event is marked processed.
    assert.ok(!calls.some((c) => c[0] === 'freeswitch.originate'), 'must not re-originate');
    assert.deepEqual(calls, [['outboxEvent.update', {
      where: { id: 'event-1' },
      data: { status: 'processed', processedAt: calls[0][1].data.processedAt, lastError: null, lockedAt: null, lockedBy: null },
    }]]);
  });

  it('treats a call already active on FreeSWITCH as placed, without re-dialing or failing', async () => {
    const calls: Call[] = [];
    const prisma = {
      $transaction: async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[]),
      outboxEvent: { update: async (args: unknown) => { calls.push(['outboxEvent.update', args]); return args; } },
      callAttempt: {
        findUnique: async () => ({ providerJobId: null, status: TaskStatus.CALLING }),
        update: async (args: unknown) => { calls.push(['callAttempt.update', args]); return args; },
      },
      callEvent: { create: async (args: unknown) => { calls.push(['callEvent.create', args]); return args; } },
    };
    const { FreeSwitchError } = await import('../freeswitch/freeswitch-errors.js');
    const freeswitch = {
      originate: async () => {
        throw new FreeSwitchError({
          operation: 'originate', code: 'COMMAND_REJECTED', retryable: false, providerCode: 'DUPLICATE',
        });
      },
    };

    const worker = new OutboxWorker(prisma as never, freeswitch as never, {} as never);
    await (worker as unknown as { deliver(event: unknown): Promise<void> }).deliver({
      id: 'event-1', aggregateId: 'attempt-1', type: 'call.dispatch_requested',
      attempts: 0, deduplicationKey: 'dispatch-1',
      payload: { taskId: 'task-1', attemptId: 'attempt-1', to: '+1001', from: '+1000' },
    });

    // Outbox marked processed; no callAttempt/task FAILED write for a live call.
    assert.ok(!calls.some((c) => c[0] === 'callAttempt.update'), 'must not mutate the live attempt');
    assert.equal(calls[0][0], 'outboxEvent.update');
    assert.equal(calls[0][1].data.status, 'processed');
  });

  it('sends a non-retryable dispatch error terminal on the first failure', async () => {
    const updates: any[] = [];
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
        outboxEvent: { update: async (args: any) => { updates.push(args); return args; } },
        callEvent: { create: async (args: unknown) => args },
        callAttempt: { update: async (args: unknown) => args },
        outboundTask: { update: async (args: unknown) => args },
      }),
    };
    const { FreeSwitchError } = await import('../freeswitch/freeswitch-errors.js');
    const worker = new OutboxWorker(prisma as never, {} as never, {} as never);
    const baseEvent = {
      id: 'event-1', aggregateId: 'attempt-1', type: 'call.dispatch_requested',
      deduplicationKey: 'dispatch-1',
      payload: { taskId: 'task-1', attemptId: 'attempt-1', to: '+1001', from: '+1000' },
    };
    // attempts=0 (first try) but non-retryable → must go terminal, not retry.
    await (worker as unknown as { handleFailure(event: unknown, error: Error): Promise<void> })
      .handleFailure({ ...baseEvent, attempts: 0 }, new FreeSwitchError({
        operation: 'originate', code: 'INVALID_CONFIGURATION', retryable: false,
      }));
    assert.equal(updates[0].data.status, 'failed');
  });

  it('records processed batch metrics and backlog snapshots', async () => {
    const metrics = new MetricsService();
    const event = {
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
    };
    const prisma = {
      $transaction: async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[]),
      outboxEvent: {
        updateMany: async (args: any) => (
          args.where?.id === 'event-1' ? { count: 1 } : { count: 0 }
        ),
        findMany: async () => [event],
        update: async (args: unknown) => args,
      },
      callAttempt: {
        findUnique: async () => ({ providerJobId: null, status: TaskStatus.CALLING }),
        update: async (args: unknown) => args,
      },
      callEvent: {
        create: async (args: unknown) => args,
      },
    };
    const freeswitch = {
      originate: async () => ({
        accepted: true as const,
        jobId: 'job-1',
        replyText: '+OK Job-UUID: job-1',
      }),
    };

    const worker = new OutboxWorker(prisma as never, freeswitch as never, {} as never, metrics);

    await worker.processBatch();

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.counters['outbox.tick'], 1);
    assert.equal(snapshot.counters['outbox.processed'], 1);
    assert.equal(snapshot.gauges['outbox.backlog'], 1);
    assert.equal(snapshot.durations['outbox.batch.duration_ms'].count, 1);
  });

  it('records retrying and terminal failure metrics', async () => {
    const metrics = new MetricsService();
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
        outboxEvent: { update: async (args: unknown) => args },
        callEvent: { create: async (args: unknown) => args },
        callAttempt: { update: async (args: unknown) => args },
        outboundTask: { update: async (args: unknown) => args },
      }),
    };
    const worker = new OutboxWorker(prisma as never, {} as never, {} as never, metrics);
    const baseEvent = {
      id: 'event-1',
      aggregateId: 'attempt-1',
      type: 'call.dispatch_requested',
      deduplicationKey: 'dispatch-1',
      payload: {
        taskId: 'task-1',
        attemptId: 'attempt-1',
        to: '+1001',
        from: '+1000',
      },
    };

    await (worker as unknown as { handleFailure(event: unknown, error: Error): Promise<void> })
      .handleFailure({ ...baseEvent, attempts: 0 }, new Error('temporary'));
    await (worker as unknown as { handleFailure(event: unknown, error: Error): Promise<void> })
      .handleFailure({ ...baseEvent, attempts: 4 }, new Error('terminal'));

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.counters['outbox.retrying'], 1);
    assert.equal(snapshot.counters['outbox.failed'], 1);
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

  it('routes crm action payloads through ActionDeliveryService', async () => {
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
      deliverCrm: async (payload: unknown, idempotencyKey: string) => {
        calls.push(['deliverCrm', payload, idempotencyKey]);
      },
    };

    const worker = new OutboxWorker(prisma as never, {} as never, actions as never);
    await (worker as unknown as { deliver(event: unknown): Promise<void> }).deliver({
      id: 'event-3',
      aggregateId: 'attempt-1',
      type: 'action.crm',
      attempts: 0,
      deduplicationKey: 'crm-1',
      payload: {
        taskId: 'task-1',
        attemptId: 'attempt-1',
        to: '+1001',
        config: { action: 'create_after_sale_ticket', priority: 'high' },
      },
    });

    assert.deepEqual(calls[0], ['deliverCrm', {
      taskId: 'task-1',
      attemptId: 'attempt-1',
      to: '+1001',
      config: { action: 'create_after_sale_ticket', priority: 'high' },
    }, 'crm-1']);
    assert.equal(calls[1][1].data.type, 'action.crm.delivered');
  });
});
