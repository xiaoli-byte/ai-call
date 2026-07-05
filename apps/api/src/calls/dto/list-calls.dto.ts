import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CallOutcome, TaskStatus, type ScenarioKey } from '@ai-call/shared';

export class ListCallsDto {
  @IsOptional()
  @IsString()
  scenario?: ScenarioKey;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
