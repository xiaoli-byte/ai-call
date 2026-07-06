import { IsEnum, IsInt, IsISO8601, IsObject, IsOptional, IsString, Min } from 'class-validator';
import {
  UsageMetric,
  UsagePeriod,
  type RecordUsageEventDto as SharedRecordUsageEventDto,
} from '@ai-call/shared';

export class RecordUsageEventDto implements Omit<SharedRecordUsageEventDto, 'tenantId'> {
  @IsString()
  idempotencyKey!: string;

  @IsEnum(UsageMetric)
  metric!: SharedRecordUsageEventDto['metric'];

  @IsOptional()
  @IsEnum(UsagePeriod)
  period?: SharedRecordUsageEventDto['period'];

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsISO8601()
  at?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
