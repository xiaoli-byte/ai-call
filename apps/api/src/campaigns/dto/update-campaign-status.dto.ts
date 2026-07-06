import { IsIn, IsOptional, IsString } from 'class-validator';
import type { CampaignStatus } from '@ai-call/shared';

const CAMPAIGN_STATUSES: CampaignStatus[] = [
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
  'failed',
];

export class UpdateCampaignStatusDto {
  @IsIn(CAMPAIGN_STATUSES)
  status!: CampaignStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
