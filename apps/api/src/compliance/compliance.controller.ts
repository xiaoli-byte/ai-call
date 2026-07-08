import { Body, Controller, Get, Patch, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import type { AuthClaims } from '@xiaoli-byte/authz/core';
import { CurrentUser, Permissions } from '../auth/decorators.js';
import { AuthService } from '../auth/auth.service.js';
import { CompliancePolicyUpdateDto } from './dto/compliance-policy.dto.js';
import { ComplianceService } from './compliance.service.js';

@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly complianceService: ComplianceService,
    private readonly authService: AuthService,
  ) {}

  @Get('policy')
  @Permissions(PERMISSIONS.SCENARIO_READ)
  getPolicy() {
    return this.complianceService.getPolicy();
  }

  @Patch('policy')
  @Permissions(PERMISSIONS.SCENARIO_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  async updatePolicy(@Body() dto: CompliancePolicyUpdateDto, @CurrentUser() claims: AuthClaims) {
    const user = claims ? await this.authService.buildUserProfile(claims.sub) : undefined;
    return this.complianceService.updatePolicy(dto, user);
  }

  @Get('audit-logs')
  @Permissions(PERMISSIONS.SCENARIO_READ)
  listAuditLogs(@Query('limit') limit?: string) {
    return this.complianceService.listAuditLogs(limit ? Number(limit) : undefined);
  }
}
