import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TaskStatus } from '@ai-call/shared';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FreeSwitchService } from '../freeswitch/freeswitch.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
    if (this.processing) return;
    this.processing = true;
    try {
      await this.recoverExpiredLeases();
      const events = await this.prisma.outboxEvent.findMany({
        where: { status: 'pending', availableAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: Number(process.env.OUTBOX_BATCH_SIZE ?? 10),
      });
      for (const event of events) await this.processEvent(event);
    } catch (error) {
      this.logger.error(`outbox 批处理失败：${(error as Error).message}`);
    } finally {
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
      await this.deliver(event);
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
    } catch (error) {
      await this.handleFailure(event, error as Error);
    }
  }

  private async deliver(event: OutboxRecord): Promise<void> {
    if (event.type === 'call.dispatch_requested') {
      const payload = parseOutboxPayload(event.type, event.payload);
      await this.freeswitch.originate(payload.to, payload.attemptId);
      await this.prisma.$transaction([
        this.prisma.callAttempt.update({
          where: { id: payload.attemptId },
          data: { status: TaskStatus.CALLING, ringingAt: new Date() },
        }),
        this.prisma.callEvent.create({
          data: {
            taskId: payload.taskId,
            attemptId: payload.attemptId,
            type: 'call.dispatch_accepted',
            payload: callEventPayload('call.dispatch_accepted', {}),
          },
        }),
      ]);
      return;
    }
    if (event.type === 'action.sms') {
      const payload = parseOutboxPayload(event.type, event.payload);
      await this.actions.deliverSms(
        { taskId: payload.taskId, attemptId: payload.attemptId, to: payload.to, config: payload.config },
        event.deduplicationKey ?? event.id,
      );
      await this.recordActionDelivered(payload, 'sms');
      return;
    }
    if (event.type === 'action.api') {
      const payload = parseOutboxPayload(event.type, event.payload);
      await this.actions.deliverWebhook(
        { taskId: payload.taskId, attemptId: payload.attemptId, config: payload.config },
        event.deduplicationKey ?? event.id,
      );
      await this.recordActionDelivered(payload, 'api');
      return;
    }
    throw new Error(`Unsupported outbox event: ${event.type}`);
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
    const terminal = attempts >= Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);
    const message = error.message.slice(0, 1000);
    const payload = parseOutboxPayload(event.type as OutboxEventType, event.payload);
    const eventType = outboxFailureCallEventType(event.type as OutboxEventType, terminal);
    await this.prisma.$transaction(async (tx) => {
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: terminal ? 'failed' : 'pending',
          availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** attempts)),
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
        await tx.callAttempt.update({
          where: { id: payload.attemptId },
          data: { status: TaskStatus.FAILED, endedAt: new Date(), hangupCause: message },
        });
        await tx.outboundTask.update({
          where: { id: payload.taskId },
          data: { status: TaskStatus.FAILED, endedAt: new Date() },
        });
      }
    });
    this.logger.warn(`outbox event ${event.id} failed (${attempts}): ${message}`);
  }
}
