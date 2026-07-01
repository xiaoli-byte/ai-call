import {
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsObject,
  IsString,
} from 'class-validator';
import { CallOutcome, TaskStatus } from '@ai-call/shared';

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus)
  status!: TaskStatus;
}

export class TranscriptTurnDto {
  @IsIn(['agent', 'caller', 'system'])
  role!: 'agent' | 'caller' | 'system';

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  emotion?: string;
}

export class SetOutcomeDto {
  @IsEnum(CallOutcome)
  outcome!: CallOutcome;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class HangupDto {
  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class FlowActionDto {
  @IsIn(['sms', 'api'])
  actionType!: 'sms' | 'api';

  @IsObject()
  config!: Record<string, unknown>;
}
