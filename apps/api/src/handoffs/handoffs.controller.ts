import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS, type HandoffTicketStatus } from '@ai-call/shared';
import { Permissions } from '../auth/decorators.js';
import { CreateCallbackTaskDto } from './dto/create-callback-task.dto.js';
import { UpdateHandoffTicketDto } from './dto/update-handoff-ticket.dto.js';
import { HandoffsService } from './handoffs.service.js';

@Controller('handoffs')
@Permissions(PERMISSIONS.CALL_READ)
export class HandoffsController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Get()
  list(
    @Query('status') status?: HandoffTicketStatus,
    @Query('campaignId') campaignId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.handoffs.list({
      status,
      campaignId,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.handoffs.get(id);
  }

  @Post('from-analysis/:analysisId')
  @Permissions(PERMISSIONS.CALL_READ)
  createFromAnalysis(@Param('analysisId') analysisId: string) {
    return this.handoffs.createFromAnalysis(analysisId);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.TASK_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  update(@Param('id') id: string, @Body() dto: UpdateHandoffTicketDto) {
    return this.handoffs.update(id, dto);
  }

  @Post(':id/callback-task')
  @Permissions(PERMISSIONS.TASK_CREATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  createCallback(@Param('id') id: string, @Body() dto: CreateCallbackTaskDto) {
    return this.handoffs.createCallbackTask(id, dto);
  }
}
