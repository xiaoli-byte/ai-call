import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { FreeSwitchModule } from '../freeswitch/freeswitch.module.js';
import { TaskFlowsModule } from '../task-flows/task-flows.module.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';
import { OutboxModule } from './outbox.module.js';

@Module({
  imports: [FreeSwitchModule, TaskFlowsModule, OutboxModule],
  controllers: [TasksController],
  providers: [TasksService, ServiceAuthGuard],
})
export class TasksModule {}
