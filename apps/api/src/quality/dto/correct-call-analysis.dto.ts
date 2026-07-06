import { IsArray, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { CallOutcome, type QualityRiskLevel } from '@ai-call/shared';

const RISK_LEVELS: QualityRiskLevel[] = ['low', 'medium', 'high'];

export class CorrectCallAnalysisDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  intent?: string;

  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;

  @IsOptional()
  @IsString()
  refusalReason?: string;

  @IsOptional()
  @IsString()
  nextAction?: string;

  @IsOptional()
  @IsIn(RISK_LEVELS)
  riskLevel?: QualityRiskLevel;

  @IsOptional()
  @IsArray()
  complianceFlags?: string[];
}
