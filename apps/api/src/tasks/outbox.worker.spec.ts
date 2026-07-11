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
        findUnique: async () => ({ providerJobId: null, status: TaskStatus.CALLING, dispatchStartedAt: null }),
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

    // 用例(a):originate 之前先写入"派发在途"标记(单独一笔,崩溃时可幸存)。
    assert.equal(calls[0][0], 'callAttempt.update');
    assert.deepEqual(calls[0][1].where, { id: 'attempt-1' });
    assert.ok(calls[0][1].data.dispatchStartedAt instanceof Date, 'marker must be a Date');
    assert.deepEqual(Object.keys(calls[0][1].data), ['dispatchStartedAt']);
    // 标记落库后才真正拨号。
    assert.deepEqual(calls[1], ['freeswitch.originate', '+1001', 'attempt-1:task-1']);
    assert.deepEqual(calls[2], ['callAttempt.update', {
      where: { id: 'attempt-1' },
      data: { providerJobId: 'job-1' },
    }]);
    assert.equal(calls[3][0], 'callEvent.create');
    assert.equal(calls[3][1].data.type, 'call.dispatch_accepted');
    assert.deepEqual(calls[3][1].data.payload, {
      channel: 'freeswitch',
      provider: 'freeswitch',
      providerJobId: 'job-1',
    });
    assert.equal(calls[4][0], 'outboxEvent.update');
    assert.equal(calls[4][1].data.status, 'processed');
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
        calls.push(['freeswitch.originate', null]);
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
        findUnique: async () => ({ providerJobId: null, status: TaskStatus.CALLING, dispatchStartedAt: null }),
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

    // 唯一的 callAttempt.update 只能是无害的"派发在途"标记,绝不能写 providerJobId/FAILED 去动活着的通话。
    const attemptUpdates = calls.filter((c) => c[0] === 'callAttempt.update');
    assert.equal(attemptUpdates.length, 1, 'only the dispatch marker may be written');
    assert.deepEqual(Object.keys(attemptUpdates[0][1].data), ['dispatchStartedAt']);
    // Outbox marked processed; no providerJobId/FAILED write for a live call.
    assert.ok(calls.some((c) => c[0] === 'outboxEvent.update' && c[1].data.status === 'processed'),
      'outbox event must be marked processed');
  });

  it('closes an ambiguous dispatch (marker set, no jobId) when the event pipeline proves the call went live', async () => {
    const calls: Call[] = [];
    const prisma = {
      outboxEvent: { update: async (args: unknown) => { calls.push(['outboxEvent.update', args]); return args; } },
      callAttempt: {
        // 派发在途标记已存在但 providerJobId 仍缺失 → "曾开始派发但结局未知"的歧义态。
        findUnique: async () => ({ providerJobId: null, status: TaskStatus.CALLING, dispatchStartedAt: new Date() }),
        update: async (args: unknown) => { calls.push(['callAttempt.update', args]); return args; },
      },
      callEvent: {
        // 事件管线记录过真实通道事件(provider_event)= 确实拨出过。
        findFirst: async (args: any) => { calls.push(['callEvent.findFirst', args]); return { id: 'evt-provider-1' }; },
        create: async (args: unknown) => { calls.push(['callEvent.create', args]); return args; },
      },
    };
    const freeswitch = {
      originate: async () => { calls.push(['freeswitch.originate', null]); return { accepted: true as const, jobId: 'x', replyText: '+OK' }; },
    };

    const worker = new OutboxWorker(prisma as never, freeswitch as never, {} as never);
    const finalized = await (worker as unknown as { deliver(event: unknown): Promise<boolean> }).deliver({
      id: 'event-1', aggregateId: 'attempt-1', type: 'call.dispatch_requested',
      attempts: 0, deduplicationKey: 'dispatch-1',
      payload: { taskId: 'task-1', attemptId: 'attempt-1', to: '+1001', from: '+1000' },
    });

    // 用例(b):不重拨、不重写标记,凭 provider_event 收口 processed。
    assert.equal(finalized, true);
    assert.ok(!calls.some((c) => c[0] === 'freeswitch.originate'), 'must not re-originate');
    assert.ok(!calls.some((c) => c[0] === 'callAttempt.update'), 'must not touch the attempt');
    const findFirst = calls.find((c) => c[0] === 'callEvent.findFirst');
    assert.equal(findFirst![1].where.type, 'call.provider_event');
    assert.equal(findFirst![1].where.attemptId, 'attempt-1');
    const outbox = calls.find((c) => c[0] === 'outboxEvent.update');
    assert.equal(outbox![1].data.status, 'processed');
  });

  it('dead-letters an ambiguous dispatch (marker set, no jobId, no channel event) for manual review', async () => {
    const calls: Call[] = [];
    const prisma = {
      outboxEvent: { update: async (args: unknown) => { calls.push(['outboxEvent.update', args]); return args; } },
      callAttempt: {
        findUnique: async () => ({ providerJobId: null, status: TaskStatus.CALLING, dispatchStartedAt: new Date() }),
        update: async (args: unknown) => { calls.push(['callAttempt.update', args]); return args; },
      },
      callEvent: {
        // 无任何真实通道事件证据 → 结局无法确认。
        findFirst: async () => null,
        create: async (args: unknown) => { calls.push(['callEvent.create', args]); return args; },
      },
    };
    const freeswitch = {
      originate: async () => { calls.push(['freeswitch.originate', null]); return { accepted: true as const, jobId: 'x', replyText: '+OK' }; },
    };

    const worker = new OutboxWorker(prisma as never, freeswitch as never, {} as never);
    const finalized = await (worker as unknown as { deliver(event: unknown): Promise<boolean> }).deliver({
      id: 'event-1', aggregateId: 'attempt-1', type: 'call.dispatch_requested',
      attempts: 0, deduplicationKey: 'dispatch-1',
      payload: { taskId: 'task-1', attemptId: 'attempt-1', to: '+1001', from: '+1000' },
    });

    // 用例(c):绝不重拨、不改 attempt 状态;outbox 直接死信,lastError 含 ambiguous 供人工复核。
    assert.equal(finalized, true);
    assert.ok(!calls.some((c) => c[0] === 'freeswitch.originate'), 'must not re-originate an ambiguous dispatch');
    assert.ok(!calls.some((c) => c[0] === 'callAttempt.update'), 'must not mutate attempt status');
    const outbox = calls.find((c) => c[0] === 'outboxEvent.update');
    assert.equal(outbox![1].data.status, 'failed');
    assert.match(outbox![1].data.lastError, /ambiguous/);
  });

  it('sends a non-retryable dispatch error terminal on the first failure', async () => {
    const updates: any[] = [];
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
        outboxEvent: { update: async (args: any) => { updates.push(args); return args; } },
        callEvent: { create: async (args: unknown) => args },
        callAttempt: { updateMany: async (args: unknown) => args },
        outboundTask: { updateMany: async (args: unknown) => args },
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

  it('sends a BadRequest config error (bad webhook URL) terminal on the first failure', async () => {
    const updates: any[] = [];
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
        outboxEvent: { update: async (args: any) => { updates.push(args); return args; } },
        callEvent: { create: async (args: unknown) => args },
        callAttempt: { updateMany: async (args: unknown) => args },
        outboundTask: { updateMany: async (args: unknown) => args },
      }),
    };
    const { BadRequestException } = await import('@nestjs/common');
    const worker = new OutboxWorker(prisma as never, {} as never, {} as never);
    const baseEvent = {
      id: 'event-api', aggregateId: 'attempt-1', type: 'action.api',
      deduplicationKey: 'api-1',
      payload: { taskId: 'task-1', attemptId: 'attempt-1', config: {} },
    };
    // attempts=0 (first try) but permanent config error → terminal, not retry.
    await (worker as unknown as { handleFailure(event: unknown, error: Error): Promise<void> })
      .handleFailure({ ...baseEvent, attempts: 0 }, new BadRequestException('Invalid webhook URL'));
    assert.equal(updates[0].data.status, 'failed');
  });

  it('guards the terminal FAILED write on status CALLING (no clobber of a concurrent terminal)', async () => {
    const attemptWrites: any[] = [];
    const taskWrites: any[] = [];
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
        outboxEvent: { update: async (args: unknown) => args },
        callEvent: { create: async (args: unknown) => args },
        callAttempt: { updateMany: async (args: any) => { attemptWrites.push(args); return { count: 0 }; } },
        outboundTask: { updateMany: async (args: any) => { taskWrites.push(args); return { count: 0 }; } },
      }),
    };
    const { FreeSwitchError } = await import('../freeswitch/freeswitch-errors.js');
    const worker = new OutboxWorker(prisma as never, {} as never, {} as never);
    await (worker as unknown as { handleFailure(event: unknown, error: Error): Promise<void> })
      .handleFailure({
        id: 'event-1', aggregateId: 'attempt-1', type: 'call.dispatch_requested',
        deduplicationKey: 'dispatch-1', attempts: 0,
        payload: { taskId: 'task-1', attemptId: 'attempt-1', to: '+1001', from: '+1000' },
      }, new FreeSwitchError({ operation: 'originate', code: 'INVALID_CONFIGURATION', retryable: false }));

    // Both terminal writes must be gated on the still-dialing state.
    assert.equal(attemptWrites[0].where.status, TaskStatus.CALLING);
    assert.equal(taskWrites[0].where.status, TaskStatus.CALLING);
    assert.equal(attemptWrites[0].data.status, TaskStatus.FAILED);
    assert.equal(taskWrites[0].data.status, TaskStatus.FAILED);
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
        callAttempt: { updateMany: async (args: unknown) => args },
        outboundTask: { updateMany: async (args: unknown) => args },
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
