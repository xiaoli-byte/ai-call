import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TasksService } from './tasks.service.js';

@Injectable()
export class TaskSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(private readonly tasks: TasksService) {}

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
    this.processing = true;
    try {
      const result = await this.tasks.dispatchDuePending();
      if (result.dispatched > 0) {
        this.logger.log(
          `scheduled dispatch scanned=${result.scanned} dispatched=${result.dispatched}`,
        );
      }
    } catch (err) {
      this.logger.warn(`scheduled dispatch tick failed: ${(err as Error).message}`);
    } finally {
      this.processing = false;
    }
  }
}
