import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS, type UserProfile } from '@ai-call/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permissions } from '../auth/decorators/permissions.decorator.js';
import { CorrectCallAnalysisDto } from './dto/correct-call-analysis.dto.js';
import { ListQualityDto } from './dto/list-quality.dto.js';
import { QualityService } from './quality.service.js';

@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Get()
  @Permissions(PERMISSIONS.CALL_READ)
  @UsePipes(new ValidationPipe({ transform: true }))
  list(@Query() query: ListQualityDto) {
    return this.qualityService.list(query);
  }

  @Post(':callAttemptId/analyze')
  @Permissions(PERMISSIONS.CALL_READ)
  analyze(@Param('callAttemptId') callAttemptId: string) {
    return this.qualityService.analyzeCall(callAttemptId);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.CALL_READ)
  @UsePipes(new ValidationPipe({ transform: true }))
  correct(@Param('id') id: string, @Body() dto: CorrectCallAnalysisDto, @CurrentUser() user: UserProfile) {
    return this.qualityService.correctAnalysis(id, dto, user);
  }
}
