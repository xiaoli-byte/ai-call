import { IsISO8601, IsOptional, IsString } from 'class-validator';
import type { AnalyticsQueryDto as SharedAnalyticsQueryDto } from '@ai-call/shared';

export class AnalyticsQueryDto implements SharedAnalyticsQueryDto {
  @IsOptional()
  @IsString()
  scenario?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
