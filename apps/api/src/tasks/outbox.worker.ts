import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { TaskStatus } from '@ai-call/shared';
import { ClsService } from 'nestjs-cls';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { exponentialBackoffMs } from '../common/backoff.js';
import { FreeSwitchService } from '../freeswitch/freeswitch.service.js';
import { FreeSwitchError, isCallAlreadyActiveError } from '../freeswitch/freeswitch-errors.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runAsSystem } from '../prisma/system-context.js';
import { ActionDeliveryService } from './action-delivery.service.js';
import {
  callEventPayload,
  type FlowActionType,
  type OutboxEventType,
  outboxFailureCallEventType,
  parseOutboxPayload,
} from './task-payloads.js';

type OutboxRecord = {
  id: string;
  aggregateId: string;
  type: string;
  payload: unknown;
  attempts: number;
  deduplicationKey: string | null;
};

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly freeswitch: FreeSwitchService,
    private readonly actions: ActionDeliveryService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly cls?: ClsService,
  ) {}

  onModuleInit(): void {
    if (process.env.OUTBOX_WORKER_ENABLED === 'false') return;
    const intervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000);
    this.timer = setInterval(() => void this.processBatch(), intervalMs);
    this.timer.unref();
    void this.processBatch();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processBatch(): Promise<void> {
    // worker 无用户请求 → 无租户 CLS；在系统上下文里跑，绕过 Prisma 租户强制过滤（CALL-03）。
    return this.cls
      ? runAsSystem(this.cls, () => this.runBatch())
      : this.runBatch();
  }

  private async runBatch(): Promise<void> {
    if (this.processing) return;
    const startedAt = Date.now();
    this.processing = true;
    this.metrics?.incrementCounter('outbox.tick');
    try {
      await this.recoverExpiredLeases();
      const events = await this.prisma.outboxEvent.findMany({
        where: { status: 'pending', availableAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: Number(process.env.OUTBOX_BATCH_SIZE ?? 10),
      });
      this.metrics?.setGauge('outbox.backlog', events.length);
      for (const event of events) await this.processEvent(event);
    } catch (error) {
      this.metrics?.incrementCounter('outbox.failure');
      this.logger.error(`outbox 批处理失败：${(error as Error).message}`);
    } finally {
      this.metrics?.observeDuration('outbox.batch.duration_ms', Date.now() - startedAt);
      this.processing = false;
    }
  }

  private async recoverExpiredLeases(): Promise<void> {
    const leaseMs = Number(process.env.OUTBOX_LEASE_MS ?? 60_000);
    const expiredBefore = new Date(Date.now() - leaseMs);
    const recovered = await this.prisma.outboxEvent.updateMany({
      where: {
        status: 'processing',
        OR: [{ lockedAt: null }, { lockedAt: { lt: expiredBefore } }],
      },
      data: { status: 'pending', lockedAt: null, lockedBy: null },
    });
    if (recovered.count > 0) this.logger.warn(`recovered ${recovered.count} expired outbox leases`);
  }

  private async processEvent(event: OutboxRecord): Promise<void> {
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: { id: event.id, status: 'pending' },
      data: {
        status: 'processing',
        attempts: { increment: 1 },
        lockedAt: new Date(),
        lockedBy: this.workerId,
      },
    });
    if (claimed.count === 0) return;

    try {
      const finalized = await this.deliver(event);
      if (!finalized) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'processed',
            processedAt: new Date(),
            lastError: null,
            lockedAt: null,
            lockedBy: null,
          },
        });
      }
      this.metrics?.incrementCounter('outbox.processed');
    } catch (error) {
      await this.handleFailure(event, error as Error);
    }
  }

  private async deliver(event: OutboxRecord): Promise<boolean> {
    if (event.type === 'call.dispatch_requested') {
      const payload = parseOutboxPayload(event.type, event.payload);

      // Idempotency guard. originate() places a real phone call *before* this
      // worker commits providerJobId, so a redelivery (lease expiry, or a crash
      // between originate and commit) must never dial the same person twice.
      // If a prior delivery already recorded a job id, or the attempt has moved
      // past CALLING, the call was already placed — finish without re-dialing.
      const attempt = await this.prisma.callAttempt.findUnique({
        where: { id: payload.attemptId },
        select: { providerJobId: true, status: true },
      });
      if (attempt && (attempt.providerJobId || attempt.status !== TaskStatus.CALLING)) {
        await this.markDispatchProcessed(event.id);
        return true;
      }

      let result: Awaited<ReturnType<FreeSwitchService['originate']>>;
      try {
        result = await this.freeswitch.originate(
          payload.to,
          payload.attemptId,
          payload.taskId,
        );
      } catch (error) {
        // The call is already live on FreeSWITCH (a prior delivery originated it
        // via the deterministic origination_uuid but crashed before committing).
        // Treat as already-placed: the event pipeline owns the task state — never
        // re-dial and never mark the task FAILED for a call that is in progress.
        if (isCallAlreadyActiveError(error)) {
          this.logger.warn(
            `dispatch already active on FreeSWITCH, treating as placed attemptId=${payload.attemptId}`,
          );
          await this.markDispatchProcessed(event.id);
          return true;
        }
        throw error;
      }

      const processedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.callAttempt.update({
          where: { id: payload.attemptId },
          data: { providerJobId: result.jobId },
        }),
        this.prisma.callEvent.create({
          data: {
            taskId: payload.taskId,
            attemptId: payload.attemptId,
            type: 'call.dispatch_accepted',
            payload: callEventPayload('call.dispatch_accepted', {
              channel: 'freeswitch',
              provider: 'freeswitch',
              providerJobId: result.jobId,
            }),
          },
        }),
        this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'processed',
            processedAt,
            lastError: null,
            lockedAt: null,
            lockedBy: null,
          },
        }),
      ]);
      return true;
    }
    if (event.type === 'action.sms') {
      const payload = parseOutboxPayload(event.type, event.payload);
      await this.actions.deliverSms(
        { taskId: payload.taskId, attemptId: payload.attemptId, to: payload.to, config: payload.config },
        event.deduplicationKey ?? event.id,
      );
      await this.recordActionDelivered(payload, 'sms');
      return false;
    }
    if (event.type === 'action.api') {
      const payload = parseOutboxPayload(event.type, event.payload);
      await this.actions.deliverWebhook(
        { taskId: payload.taskId, attemptId: payload.attemptId, config: payload.config },
        event.deduplicationKey ?? event.id,
      );
      await this.recordActionDelivered(payload, 'api');
      return false;
    }
    if (event.type === 'action.crm') {
      const payload = parseOutboxPayload(event.type, event.payload);
      await this.actions.deliverCrm(
        { taskId: payload.taskId, attemptId: payload.attemptId, to: payload.to, config: payload.config },
        event.deduplicationKey ?? event.id,
      );
      await this.recordActionDelivered(payload, 'crm');
      return false;
    }
    throw new Error(`Unsupported outbox event: ${event.type}`);
  }

  /** Marks a dispatch outbox event processed without touching the call — used
   * on the idempotent no-op paths (already dialed / already active). */
  private async markDispatchProcessed(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'processed',
        processedAt: new Date(),
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  private async recordActionDelivered(
    payload: { taskId: string; attemptId?: string },
    actionType: string,
  ): Promise<void> {
    const eventType = `action.${actionType as FlowActionType}.delivered` as const;
    await this.prisma.callEvent.create({
      data: {
        taskId: payload.taskId,
        attemptId: payload.attemptId,
        type: eventType,
        payload: callEventPayload(eventType, {}),
      },
    });
  }

  private async handleFailure(event: OutboxRecord, error: Error): Promise<void> {
    const attempts = event.attempts + 1;
    // A provider error flagged non-retryable (bad config, unroutable number, an
    // unrecognized -ERR rejection) will never succeed on retry — go terminal now
    // instead of burning OUTBOX_MAX_ATTEMPTS redeliveries against the same wall.
    // (Duplicate-UUID is handled as success in deliver() and never lands here.)
    const nonRetryable = error instanceof FreeSwitchError && error.retryable === false;
    const terminal =
      nonRetryable || attempts >= Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);
    const message = error.message.slice(0, 1000);
    const payload = parseOutboxPayload(event.type as OutboxEventType, event.payload);
    const eventType = outboxFailureCallEventType(event.type as OutboxEventType, terminal);
    await this.prisma.$transaction(async (tx) => {
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: terminal ? 'failed' : 'pending',
          // attempts is 1-based here; +1 maps onto the helper's 1-based attempt
          // to preserve the prior min(60_000, 1000 * 2**attempts) schedule.
          availableAt: new Date(
            Date.now()
            + exponentialBackoffMs(attempts + 1, { baseMs: 1_000, capMs: 60_000 }),
          ),
          lastError: message,
          lockedAt: null,
          lockedBy: null,
        },
      });
      await tx.callEvent.create({
        data: {
          taskId: payload.taskId,
          attemptId: payload.attemptId,
          type: eventType,
          payload: callEventPayload(eventType, { attempts, error: message }),
        },
      });
      if (terminal && event.type === 'call.dispatch_requested' && payload.attemptId) {
        // Only fail a still-dialing task/attempt. Guarding on status (vs an
        // unconditional update) keeps dispatch-exhaustion from clobbering a
        // terminal set concurrently by another path — e.g. a user CANCEL while
        // originate retries were still failing. A dispatch failure is a distinct
        // pre-call terminal, so it stays a direct FAILED write rather than going
        // through deriveTerminalStatus (which classifies real call outcomes).
        await tx.callAttempt.updateMany({
          where: { id: payload.attemptId, status: TaskStatus.CALLING },
          data: { status: TaskStatus.FAILED, endedAt: new Date(), hangupCause: message },
        });
        await tx.outboundTask.updateMany({
          where: { id: payload.taskId, status: TaskStatus.CALLING },
          data: { status: TaskStatus.FAILED, endedAt: new Date() },
        });
      }
    });
    this.metrics?.incrementCounter(terminal ? 'outbox.failed' : 'outbox.retrying');
    this.logger.warn(`outbox event ${event.id} failed (${attempts}): ${message}`);
  }
}
