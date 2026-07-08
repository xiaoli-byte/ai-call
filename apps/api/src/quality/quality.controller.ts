import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import type { AuthClaims } from '@xiaoli-byte/authz/core';
import { CurrentUser, Permissions } from '../auth/decorators.js';
import { AuthService } from '../auth/auth.service.js';
import { CorrectCallAnalysisDto } from './dto/correct-call-analysis.dto.js';
import { ListQualityDto } from './dto/list-quality.dto.js';
import { QualityService } from './quality.service.js';

@Controller('quality')
export class QualityController {
  constructor(
    private readonly qualityService: QualityService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @Permissions(PERMISSIONS.QUALITY_READ)
  @UsePipes(new ValidationPipe({ transform: true }))
  list(@Query() query: ListQualityDto) {
    return this.qualityService.list(query);
  }

  @Post(':callAttemptId/analyze')
  @Permissions(PERMISSIONS.QUALITY_READ)
  analyze(@Param('callAttemptId') callAttemptId: string) {
    return this.qualityService.analyzeCall(callAttemptId);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.QUALITY_READ)
  @UsePipes(new ValidationPipe({ transform: true }))
  async correct(@Param('id') id: string, @Body() dto: CorrectCallAnalysisDto, @CurrentUser() claims: AuthClaims) {
    const user = claims ? await this.authService.buildUserProfile(claims.sub) : undefined;
    return this.qualityService.correctAnalysis(id, dto, user);
  }
}
