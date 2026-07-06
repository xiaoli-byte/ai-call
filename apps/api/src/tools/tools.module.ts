import { Module } from '@nestjs/common';
import { ToolsController } from './tools.controller.js';
import { ToolsService } from './tools.service.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';

@Module({
  controllers: [ToolsController],
  providers: [ToolsService, ServiceAuthGuard],
  exports: [ToolsService],
})
export class ToolsModule {}
