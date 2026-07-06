import { Module } from '@nestjs/common';
import { MetricsModule } from './metrics/metrics.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TaskSchedulerService } from './tasks/task-scheduler.service.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [PrismaModule, MetricsModule, TasksModule],
  providers: [TaskSchedulerService],
})
export class SchedulerWorkerModule {}
