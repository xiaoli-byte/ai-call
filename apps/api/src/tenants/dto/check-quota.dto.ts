import { IsEnum, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import {
  UsageMetric,
  UsagePeriod,
  type CheckTenantQuotaDto as SharedCheckTenantQuotaDto,
} from '@ai-call/shared';

export class CheckQuotaDto implements Omit<SharedCheckTenantQuotaDto, 'tenantId'> {
  @IsEnum(UsageMetric)
  metric!: SharedCheckTenantQuotaDto['metric'];

  @IsEnum(UsagePeriod)
  period!: SharedCheckTenantQuotaDto['period'];

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsISO8601()
  at?: string;
}
