import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ScenarioStatus } from '@ai-call/shared';
import type {
  EscalationRule,
  TtsVoiceConfig,
} from '@ai-call/shared';
import { DialogRepairConfigDto } from './create-scenario.dto.js';

const SCENARIO_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

export class UpdateScenarioDto {
  @IsOptional()
  @IsString()
  @Matches(SCENARIO_KEY_PATTERN, {
    message: 'scenario must start with a lowercase letter and contain only lowercase letters, numbers, _ or -',
  })
  scenario?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(Object.values(ScenarioStatus))
  status?: ScenarioStatus;

  @IsOptional()
  @IsObject()
  ttsConfig?: TtsVoiceConfig;

  @IsOptional()
  @IsString()
  agentIdentity?: string;

  @IsOptional()
  @IsString()
  communicationStyle?: string;

  @IsOptional()
  @IsString()
  communicationStylePrompt?: string;

  @IsOptional()
  @IsString()
  businessGoal?: string;

  @IsOptional()
  @IsArray()
  llmConstraints?: string[];

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  greeting?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  knowledgeBaseIds?: string[];

  @IsOptional()
  @IsString()
  knowledgeBaseId?: string;

  @IsOptional()
  @IsArray()
  allowedTools?: string[];

  @IsOptional()
  @IsArray()
  escalationRules?: EscalationRule[];

  @IsOptional()
  @IsString()
  defaultFlowId?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DialogRepairConfigDto)
  dialogRepair?: DialogRepairConfigDto;
}
