import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { OutboxModule } from './tasks/outbox.module.js';
import { TaskSchedulerService } from './tasks/task-scheduler.service.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [PrismaModule, OutboxModule, TasksModule],
  providers: [TaskSchedulerService],
})
export class OutboxWorkerModule {}
