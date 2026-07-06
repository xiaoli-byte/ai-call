import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service.js';
import { TasksService } from './tasks.service.js';

@Injectable()
export class TaskSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly tasks: TasksService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    if (process.env.TASK_SCHEDULER_ENABLED === 'false') return;
    const intervalMs = Number(process.env.TASK_SCHEDULER_INTERVAL_MS ?? 5000);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

    this.timer = setInterval(() => void this.processDueTasks(), intervalMs);
    this.timer.unref();
    void this.processDueTasks();
    this.logger.log(`scheduled task dispatcher enabled intervalMs=${intervalMs}`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processDueTasks(): Promise<void> {
    if (this.processing) return;
    const startedAt = Date.now();
    this.processing = true;
    this.metrics?.incrementCounter('scheduler.tick');
    try {
      const result = await this.tasks.dispatchDuePending();
      this.metrics?.incrementCounter('scheduler.scanned', result.scanned);
      this.metrics?.incrementCounter('scheduler.dispatched', result.dispatched);
      this.metrics?.setGauge('scheduler.last_scanned', result.scanned);
      this.metrics?.setGauge('scheduler.last_dispatched', result.dispatched);
      if (result.dispatched > 0) {
        this.logger.log(
          `scheduled dispatch scanned=${result.scanned} dispatched=${result.dispatched}`,
        );
      }
    } catch (err) {
      this.metrics?.incrementCounter('scheduler.failure');
      this.logger.warn(`scheduled dispatch tick failed: ${(err as Error).message}`);
    } finally {
      this.metrics?.observeDuration('scheduler.tick.duration_ms', Date.now() - startedAt);
      this.processing = false;
    }
  }
}
