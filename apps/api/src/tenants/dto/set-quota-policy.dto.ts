import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import {
  UsageMetric,
  UsagePeriod,
  type SetTenantQuotaPolicyDto as SharedSetTenantQuotaPolicyDto,
} from '@ai-call/shared';

export class SetQuotaPolicyDto implements SharedSetTenantQuotaPolicyDto {
  @IsEnum(UsageMetric)
  metric!: SharedSetTenantQuotaPolicyDto['metric'];

  @IsEnum(UsagePeriod)
  period!: SharedSetTenantQuotaPolicyDto['period'];

  @IsInt()
  @Min(1)
  limit!: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
