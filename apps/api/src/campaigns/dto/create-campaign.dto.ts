import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  CampaignEndCondition,
  CampaignRetryPolicy,
  CreateCampaignDto as SharedCreateCampaignDto,
} from '@ai-call/shared';
import { TaskPriority } from '@ai-call/shared';
import { IsEnum, Matches } from 'class-validator';
import { TASK_DESTINATION_PATTERN } from '../../tasks/task-destination.js';

export class CampaignLeadInputDto {
  @IsString()
  @Matches(TASK_DESTINATION_PATTERN)
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}

export class CreateCampaignDto implements SharedCreateCampaignDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  scenario!: SharedCreateCampaignDto['scenario'];

  @IsOptional()
  @IsUUID()
  scenarioId?: string;

  @IsOptional()
  @IsUUID()
  flowId?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  concurrencyLimit?: number;

  @IsOptional()
  @IsObject()
  retryPolicy?: Partial<CampaignRetryPolicy>;

  @IsOptional()
  @IsObject()
  endCondition?: CampaignEndCondition;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CampaignLeadInputDto)
  leads!: CampaignLeadInputDto[];
}
