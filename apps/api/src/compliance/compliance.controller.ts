import { Body, Controller, Get, Patch, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS, type UserProfile } from '@ai-call/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permissions } from '../auth/decorators/permissions.decorator.js';
import { CompliancePolicyUpdateDto } from './dto/compliance-policy.dto.js';
import { ComplianceService } from './compliance.service.js';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('policy')
  @Permissions(PERMISSIONS.SCENARIO_READ)
  getPolicy() {
    return this.complianceService.getPolicy();
  }

  @Patch('policy')
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  updatePolicy(@Body() dto: CompliancePolicyUpdateDto, @CurrentUser() user: UserProfile) {
    return this.complianceService.updatePolicy(dto, user);
  }

  @Get('audit-logs')
  @Permissions(PERMISSIONS.SCENARIO_READ)
  listAuditLogs(@Query('limit') limit?: string) {
    return this.complianceService.listAuditLogs(limit ? Number(limit) : undefined);
  }
}
