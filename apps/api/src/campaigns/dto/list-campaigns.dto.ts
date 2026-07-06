import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { CampaignStatus } from '@ai-call/shared';

const CAMPAIGN_STATUSES: CampaignStatus[] = [
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
  'failed',
];

export class ListCampaignsDto {
  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES)
  status?: CampaignStatus;

  @IsOptional()
  @IsString()
  scenario?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
