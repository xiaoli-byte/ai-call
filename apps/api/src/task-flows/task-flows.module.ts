import { Module } from '@nestjs/common';
import { TaskFlowsController } from './task-flows.controller.js';
import { TaskFlowsService } from './task-flows.service.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';
import { ScenariosModule } from '../scenarios/scenarios.module.js';

@Module({
  imports: [ScenariosModule],
  controllers: [TaskFlowsController],
  providers: [TaskFlowsService, ServiceAuthGuard],
  exports: [TaskFlowsService],
})
export class TaskFlowsModule {}
