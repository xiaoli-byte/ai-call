import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import type { CloneTemplateDto, PlatformQueryDto } from '@ai-call/shared';
import { Permissions } from '../auth/decorators.js';
import { PlatformService } from './platform.service.js';

@Controller()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('observability/overview')
  @Permissions(PERMISSIONS.PLATFORM_READ)
  observability(@Query() query: PlatformQueryDto) {
    return this.platform.getObservabilityOverview(query);
  }

  @Get('costs/overview')
  @Permissions(PERMISSIONS.PLATFORM_READ)
  costs(@Query() query: PlatformQueryDto) {
    return this.platform.getCostOverview(query);
  }

  @Get('templates')
  @Permissions(PERMISSIONS.PLATFORM_READ)
  templates() {
    return this.platform.listTemplates();
  }

  @Post('templates/:id/clone')
  @Permissions(PERMISSIONS.PLATFORM_CREATE)
  cloneTemplate(@Param('id') id: string, @Body() dto: CloneTemplateDto) {
    return this.platform.cloneTemplate(id, dto);
  }

  @Get('organizations/overview')
  @Permissions(PERMISSIONS.PLATFORM_READ)
  organizations() {
    return this.platform.getOrganizationsOverview();
  }

  @Get('datasets/overview')
  @Permissions(PERMISSIONS.PLATFORM_READ)
  datasets() {
    return this.platform.getDatasetOverview();
  }

  @Get('demo-guide')
  @Permissions(PERMISSIONS.PLATFORM_READ)
  demoGuide() {
    return this.platform.getDemoGuide();
  }
}
