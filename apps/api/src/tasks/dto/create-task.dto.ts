import { IsEnum, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { Scenario } from '@ai-call/shared';

export class CreateTaskDto {
  @IsString()
  @Matches(/^\+?\d{6,15}$/)
  to!: string;

  @IsEnum(Scenario)
  scenario!: Scenario;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  /** 关联的流程配置 ID（指定后 Voice Agent 按流程执行）*/
  @IsOptional()
  @IsUUID()
  flowId?: string;
}
