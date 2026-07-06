import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import {
  TenantStatus,
  type UpdateTenantDto as SharedUpdateTenantDto,
} from '@ai-call/shared';

export class UpdateTenantDto implements SharedUpdateTenantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: SharedUpdateTenantDto['status'];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
