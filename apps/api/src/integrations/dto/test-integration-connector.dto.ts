import { IsObject, IsOptional, IsString } from 'class-validator';

export class TestIntegrationConnectorDto {
  @IsOptional()
  @IsObject()
  sampleVariables?: Record<string, string>;

  @IsOptional()
  @IsString()
  sourceTaskId?: string;

  @IsOptional()
  @IsString()
  sourceAttemptId?: string;
}
