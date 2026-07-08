import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CostsService } from './costs.service.js';
import { DatasetsService } from './datasets.service.js';
import { DemoGuideService } from './demo-guide.service.js';
import { HealthChecksService } from './health-checks.service.js';
import { ObservabilityService } from './observability.service.js';
import { OrganizationsService } from './organizations.service.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import { TemplatesService } from './templates.service.js';

@Module({
  imports: [PrismaModule, MetricsModule],
  controllers: [PlatformController],
  providers: [
    PlatformService,
    ObservabilityService,
    CostsService,
    TemplatesService,
    OrganizationsService,
    DatasetsService,
    DemoGuideService,
    HealthChecksService,
  ],
})
export class PlatformModule {}
