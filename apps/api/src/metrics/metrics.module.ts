import { Module } from '@nestjs/common';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, ServiceAuthGuard],
  exports: [MetricsService],
})
export class MetricsModule {}
