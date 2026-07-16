import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScenarioStatus } from '@ai-call/shared';
import type {
  EscalationRule,
  TtsVoiceConfig,
} from '@ai-call/shared';

const SCENARIO_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
const SIDE_QUESTION_BRIDGE_VALUES = ['natural', 'template'] as const;
const SILENCE_ACTION_VALUES = ['hangup', 'transfer'] as const;

/**
 * 对话修复话术配置（无应答重问/未理解澄清/STT 异常重试/插问兜底等），
 * 各字段均为可选，留空时运行时使用 Python 侧默认文案。
 *
 * 持久化：OutboundScenario 表的 dialog_repair 列（Json，默认 '{}'，
 * 迁移 20260715140556_add_scenario_dialog_repair）负责存储，见 scenarios.service.ts
 * 的 toCreateData/toUpdateData/toDomain。
 */
export class DialogRepairConfigDto {
  @IsOptional()
  @IsString()
  noInputPrompt?: string;

  @IsOptional()
  @IsString()
  noInputGiveUpPrompt?: string;

  @IsOptional()
  @IsString()
  noMatchPrompt?: string;

  @IsOptional()
  @IsString()
  noMatchGiveUpPrompt?: string;

  @IsOptional()
  @IsString()
  repeatAckPrompt?: string;

  @IsOptional()
  @IsString()
  holdAckPrompt?: string;

  @IsOptional()
  @IsString()
  questionRequestAckPrompt?: string;

  @IsOptional()
  @IsString()
  sttRetryPrompt?: string;

  @IsOptional()
  @IsString()
  sttGiveUpPrompt?: string;

  @IsOptional()
  @IsString()
  sideQuestionFallbackPrompt?: string;

  @IsOptional()
  @IsString()
  sideQuestionDeferPrompt?: string;

  @IsOptional()
  @IsIn(SIDE_QUESTION_BRIDGE_VALUES)
  sideQuestionBridge?: 'natural' | 'template';

  @IsOptional()
  @IsString()
  sideQuestionBridgeTemplate?: string;

  /** natural 模式下「插话后回到流程」的提示词（支持 {question}） */
  @IsOptional()
  @IsString()
  sideQuestionResumePrompt?: string;

  /** 插话应答过渡语：识别为插话后、查询答案前先播的短句，留空用运行时默认 */
  @IsOptional()
  @IsString()
  sideQuestionAck?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  silencePrompt?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600000)
  silenceTimeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxSilenceRounds?: number;

  @IsOptional()
  @IsIn(SILENCE_ACTION_VALUES)
  silenceAction?: 'hangup' | 'transfer';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  silenceTransferPrompt?: string;
}

export class CreateScenarioDto {
  @IsString()
  @Matches(SCENARIO_KEY_PATTERN, {
    message: 'scenario must start with a lowercase letter and contain only lowercase letters, numbers, _ or -',
  })
  scenario!: string;

  @IsString()
  name!: string;

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
  defaultFlowId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DialogRepairConfigDto)
  dialogRepair?: DialogRepairConfigDto;
}
