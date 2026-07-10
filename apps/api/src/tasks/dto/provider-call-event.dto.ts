import {
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class ProviderCallEventDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(64)
  provider?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(256)
  providerEventId?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(128)
  eventType!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(128)
  taskId?: string;

  @ValidateIf((event: ProviderCallEventDto) =>
    event.attemptId !== undefined ||
    (!hasNonBlankString(event.providerCallId) && !hasNonBlankString(event.jobId)))
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(128)
  attemptId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(256)
  providerCallId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(128)
  jobId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  backgroundJobResult?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  hangupCause?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  recordingPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  recordingUrl?: string;

  @IsOptional()
  @IsObject()
  raw?: Record<string, unknown>;
}

function hasNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
