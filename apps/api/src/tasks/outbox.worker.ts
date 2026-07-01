import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TaskStatus } from '@ai-call/shared';
import { FreeSwitchService } from '../freeswitch/freeswitch.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly freeswitch: FreeSwitchService,
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
      const events = await this.prisma.outboxEvent.findMany({
        where: { status: 'pending', availableAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      for (const event of events) await this.processEvent(event);
    } finally {
      this.processing = false;
    }
  }

  private async processEvent(event: {
    id: string;
    aggregateId: string;
    type: string;
    payload: unknown;
    attempts: number;
  }): Promise<void> {
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: { id: event.id, status: 'pending' },
      data: { status: 'processing', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return;

    try {
      if (event.type === 'call.dispatch_requested') {
        const payload = event.payload as { taskId: string; to: string };
        await this.freeswitch.originate(payload.to, payload.taskId);
        await this.prisma.$transaction([
          this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'processed', processedAt: new Date(), lastError: null },
          }),
          this.prisma.callEvent.create({
            data: { taskId: payload.taskId, type: 'call.dispatch_accepted', payload: {} as never },
          }),
        ]);
      } else {
        throw new Error(`Unsupported outbox event: ${event.type}`);
      }
    } catch (error) {
      const attempts = event.attempts + 1;
      const terminal = attempts >= 5;
      const message = (error as Error).message.slice(0, 1000);
      await this.prisma.$transaction(async (tx) => {
        await tx.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: terminal ? 'failed' : 'pending',
            availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** attempts)),
            lastError: message,
          },
        });
        await tx.callEvent.create({
          data: {
            taskId: event.aggregateId,
            type: terminal ? 'call.dispatch_failed' : 'call.dispatch_retrying',
            payload: { attempts, error: message } as never,
          },
        });
        if (terminal) {
          await tx.outboundTask.update({
            where: { id: event.aggregateId },
            data: { status: TaskStatus.FAILED, endedAt: new Date() },
          });
        }
      });
      this.logger.warn(`outbox event ${event.id} failed (${attempts}/5): ${message}`);
    }
  }
}
