import { IsBoolean, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import {
  TenantProviderType,
  type UpsertTenantProviderConfigDto as SharedUpsertTenantProviderConfigDto,
} from '@ai-call/shared';

export class UpsertProviderConfigDto implements SharedUpsertTenantProviderConfigDto {
  @IsEnum(TenantProviderType)
  providerType!: SharedUpsertTenantProviderConfigDto['providerType'];

  @IsString()
  providerName!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  secretRef?: string;

  @IsOptional()
  @IsObject()
  configEncrypted?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
