import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators/permissions.decorator.js';
import { CampaignsService } from './campaigns.service.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';
import { ListCampaignsDto } from './dto/list-campaigns.dto.js';
import { UpdateCampaignStatusDto } from './dto/update-campaign-status.dto.js';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @Permissions(PERMISSIONS.TASK_READ)
  @UsePipes(new ValidationPipe({ transform: true }))
  list(@Query() query: ListCampaignsDto) {
    return this.campaignsService.list(query);
  }

  @Post()
  @Permissions(PERMISSIONS.TASK_CREATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(dto);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.TASK_READ)
  get(@Param('id') id: string) {
    return this.campaignsService.get(id);
  }

  @Patch(':id/status')
  @Permissions(PERMISSIONS.TASK_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCampaignStatusDto) {
    return this.campaignsService.updateStatus(id, dto);
  }
}
