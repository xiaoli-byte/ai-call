import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { TaskPriority } from '@ai-call/shared';
import { TASK_DESTINATION_PATTERN } from '../task-destination.js';

export class CreateTaskBatchItemDto {
  @IsString()
  @Matches(TASK_DESTINATION_PATTERN)
  to!: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  campaignLeadId?: string;
}

export class CreateTaskBatchDto {
  @IsString()
  scenario!: string;

  @IsOptional()
  @IsUUID()
  scenarioId?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  flowId?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskBatchItemDto)
  items!: CreateTaskBatchItemDto[];
}
