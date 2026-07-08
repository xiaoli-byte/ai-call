import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsQueryDto } from './dto/analytics-query.dto.js';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @Permissions(PERMISSIONS.ANALYTICS_READ)
  @UsePipes(new ValidationPipe({ transform: true }))
  overview(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getOverview(query);
  }
}
