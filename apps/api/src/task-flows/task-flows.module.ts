import { Module } from '@nestjs/common';
import { TaskFlowsController } from './task-flows.controller.js';
import { TaskFlowsService } from './task-flows.service.js';

@Module({
  controllers: [TaskFlowsController],
  providers: [TaskFlowsService],
  exports: [TaskFlowsService],
})
export class TaskFlowsModule {}
