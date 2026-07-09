import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators.js';
import { CampaignsService } from './campaigns.service.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';
import { ListCampaignsDto } from './dto/list-campaigns.dto.js';
import { UpdateCampaignStatusDto } from './dto/update-campaign-status.dto.js';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @Permissions(PERMISSIONS.CAMPAIGN_READ)
  @UsePipes(new ValidationPipe({ transform: true }))
  list(@Query() query: ListCampaignsDto) {
    return this.campaignsService.list(query);
  }

  @Post()
  @Permissions(PERMISSIONS.CAMPAIGN_CREATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(dto);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.CAMPAIGN_READ)
  async get(@Param('id') id: string) {
    await this.campaignsService.assertCampaignVisible(id);
    return this.campaignsService.get(id);
  }

  @Get(':id/strategy-simulation')
  @Permissions(PERMISSIONS.CAMPAIGN_READ)
  simulateStrategy(@Param('id') id: string) {
    return this.campaignsService.simulateStrategy(id);
  }

  @Patch(':id/status')
  @Permissions(PERMISSIONS.CAMPAIGN_UPDATE)
  @UsePipes(new ValidationPipe({ transform: true }))
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCampaignStatusDto) {
    return this.campaignsService.updateStatus(id, dto);
  }
}
