import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { HandoffsController } from './handoffs.controller.js';
import { HandoffsService } from './handoffs.service.js';

@Module({
  imports: [TasksModule],
  controllers: [HandoffsController],
  providers: [HandoffsService],
  exports: [HandoffsService],
})
export class HandoffsModule {}
