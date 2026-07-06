import { Body, Controller, Get, Param, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators/permissions.decorator.js';
import { CreateIntegrationConnectorDto } from './dto/create-integration-connector.dto.js';
import { TestIntegrationConnectorDto } from './dto/test-integration-connector.dto.js';
import { IntegrationsService } from './integrations.service.js';

@Controller('integrations')
@Permissions(PERMISSIONS.TASK_READ)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list() {
    return this.integrations.list();
  }

  @Post()
  @Permissions(PERMISSIONS.TASK_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateIntegrationConnectorDto) {
    return this.integrations.create(dto);
  }

  @Post(':id/test')
  @Permissions(PERMISSIONS.TASK_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  test(@Param('id') id: string, @Body() dto: TestIntegrationConnectorDto) {
    return this.integrations.test(id, dto);
  }

  @Get('logs')
  logs(
    @Query('connectorId') connectorId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.integrations.listLogs({
      connectorId,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
