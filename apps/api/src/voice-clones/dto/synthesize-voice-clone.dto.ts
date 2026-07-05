import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SynthesizeVoiceCloneDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
