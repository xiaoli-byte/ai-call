import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CallOutcome, type QualityRiskLevel } from '@ai-call/shared';

const RISK_LEVELS: QualityRiskLevel[] = ['low', 'medium', 'high'];

export class ListQualityDto {
  @IsOptional()
  @IsIn(RISK_LEVELS)
  riskLevel?: QualityRiskLevel;

  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

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
