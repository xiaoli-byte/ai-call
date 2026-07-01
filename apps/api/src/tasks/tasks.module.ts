import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { FreeSwitchModule } from '../freeswitch/freeswitch.module.js';
import { TaskFlowsModule } from '../task-flows/task-flows.module.js';
import { OutboxWorker } from './outbox.worker.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';

@Module({
  imports: [FreeSwitchModule, TaskFlowsModule],
  controllers: [TasksController],
  providers: [TasksService, OutboxWorker, ServiceAuthGuard],
})
export class TasksModule {}
