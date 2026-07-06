import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import type {
  IntegrationAuthType,
  IntegrationConnectorType,
} from '@ai-call/shared';

const CONNECTOR_TYPES: IntegrationConnectorType[] = ['webhook', 'crm', 'sms', 'internal_api'];
const AUTH_TYPES: IntegrationAuthType[] = ['none', 'bearer', 'basic', 'api_key'];

export class CreateIntegrationConnectorDto {
  @IsString()
  name!: string;

  @IsIn(CONNECTOR_TYPES)
  type!: IntegrationConnectorType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  endpoint!: string;

  @IsOptional()
  @IsIn(AUTH_TYPES)
  authType?: IntegrationAuthType;

  @IsOptional()
  @IsObject()
  authConfig?: Record<string, unknown>;

  @IsOptional()
  requestTemplate?: unknown;

  @IsOptional()
  @IsObject()
  responseMapping?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
