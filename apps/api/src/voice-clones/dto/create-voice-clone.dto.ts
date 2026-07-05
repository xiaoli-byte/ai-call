import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateVoiceCloneDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  voiceId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  model?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  promptText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
