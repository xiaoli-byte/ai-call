import { IsEnum, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { TaskPriority } from '@ai-call/shared';
import { TASK_DESTINATION_PATTERN } from '../task-destination.js';

export class CreateTaskDto {
  @IsString()
  @Matches(TASK_DESTINATION_PATTERN)
  to!: string;

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

  /** 关联的流程配置 ID（指定后 Voice Agent 按流程执行）*/
  @IsOptional()
  @IsUUID()
  flowId?: string;
}
