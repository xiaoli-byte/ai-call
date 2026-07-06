import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { ServiceAuthGuard } from '../common/service-auth.guard.js';
import { MetricsService, type MetricsSnapshot } from './metrics.service.js';

@Controller('internal/metrics')
@Public()
@UseGuards(ServiceAuthGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  snapshot(): MetricsSnapshot {
    return this.metrics.snapshot();
  }
}
