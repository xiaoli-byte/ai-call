import { IsObject, IsOptional, IsString, Matches } from 'class-validator';
import type { CreateTenantDto as SharedCreateTenantDto } from '@ai-call/shared';

const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

export class CreateTenantDto implements SharedCreateTenantDto {
  @IsString()
  @Matches(TENANT_SLUG_PATTERN)
  slug!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
