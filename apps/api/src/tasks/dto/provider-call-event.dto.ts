import {
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class ProviderCallEventDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsString()
  eventType!: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  attemptId?: string;

  @IsOptional()
  @IsString()
  providerCallId?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  hangupCause?: string;

  @IsOptional()
  @IsString()
  recordingPath?: string;

  @IsOptional()
  @IsString()
  recordingUrl?: string;

  @IsOptional()
  @IsObject()
  raw?: Record<string, unknown>;
}
