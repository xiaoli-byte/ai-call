'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Headphones,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  Volume2,
} from 'lucide-react';
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormInput, FormTextarea } from '@/components/ui/form-field';
import {
  DIALOG_REPAIR_DEFAULTS,
  FlowStatus,
  PERMISSIONS,
  SCENARIO_INDUSTRY_TEMPLATES,
  ScenarioStatus,
  VoiceCloneStatus,
  type CreateScenarioDto,
  type DialogRepairConfig,
  type EscalationRule,
  type ScenarioConfig,
  type ScenarioIndustryTemplate,
  type TaskFlow,
} from '@ai-call/shared';
import { useScenarioMutations, useScenarios } from '@/hooks/use-scenarios';
import { useTaskFlows } from '@/hooks/use-task-flows';
import { useVoiceCloneMutations, useVoiceClones } from '@/hooks/use-voice-clones';
import { useTTS } from '@/hooks/useTTS';
import { usePermission } from '@/hooks/use-permission';
import { useThrottleFn } from '@/hooks/use-throttle-fn';
import { BUILT_IN_TTS_VOICES, getBuiltInVoicePersona, isBuiltInTtsVoice } from '@/lib/tts-voices';
import { cn } from '@/lib/utils';
import { appToast } from '@/lib/toast';
import { ScenarioPageTitle, ScenarioTab, ScenarioTabs } from '@/components/scenario-workbench/page-chrome';

import styles from './scenarios.module.scss';

type DetailTab = 'robot' | 'voice';

interface ScenarioDraft {
  id?: string;
  scenario: string;
  name: string;
  description: string;
  status: ScenarioStatus;
  ttsVoice: string;
  ttsVoiceCloneId: string;
  ttsProvider: string;
  ttsAge: string;
  ttsSpeakingRate: string;
  ttsPitch: string;
  ttsStylePrompt: string;
  ttsVoicePersona: string;
  agentIdentity: string;
  /** 「身份」自定义标签（不在 IDENTITY_PRESETS 内置列表中的可删除标签），仅用于表单回显，不提交给后端 */
  customIdentityTags: string[];
  communicationStyle: string;
  /** 「沟通风格」自定义标签（不在 STYLE_PRESETS 内置列表中的可删除标签），仅用于表单回显，不提交给后端 */
  customStyleTags: string[];
  communicationStylePrompt: string;
  businessGoal: string;
  llmConstraintsText: string;
  systemPrompt: string;
  greeting: string;
  knowledgeBaseId: string;
  allowedToolsText: string;
  escalationRules: EscalationRule[];
  defaultFlowId: string;
  dialogRepair: DialogRepairDraft;
  updatedAt?: string;
}

/** 对话修复话术表单草稿：字符串字段留空表示沿用运行时默认文案 */
interface DialogRepairDraft {
  noInputPrompt: string;
  noInputGiveUpPrompt: string;
  noMatchPrompt: string;
  noMatchGiveUpPrompt: string;
  repeatAckPrompt: string;
  holdAckPrompt: string;
  questionRequestAckPrompt: string;
  sttRetryPrompt: string;
  sttGiveUpPrompt: string;
  sideQuestionFallbackPrompt: string;
  sideQuestionDeferPrompt: string;
  sideQuestionBridge: 'natural' | 'template';
  sideQuestionBridgeTemplate: string;
  /** natural 模式下「插话后回到流程」的承接提示词，留空使用运行时内置默认 */
  sideQuestionResumePrompt: string;
  /**
   * 是否在插话时先播应答语（默认开启）。
   * 取消勾选 = 显式禁用：提交 sideQuestionAck: ""（wire 上「键存在且为空串」= 不播过渡语）；
   * 勾选 = 正常语义：文本留空提交时省略该键（= 运行时默认），有文本则提交文本。
   */
  sideQuestionAckEnabled: boolean;
  /** 插话应答过渡语：查询答案前先播的一句短话，留空使用运行时内置默认 */
  sideQuestionAck: string;
  /** 以下静默相关字段：数字项在草稿中以 string 表示，便于绑定 input，提交时再 parseInt 校验 */
  silencePrompt: string;
  silenceTimeoutMs: string;
  maxSilenceRounds: string;
  silenceAction: 'hangup' | 'transfer';
  silenceTransferPrompt: string;
}

/**
 * 场景编辑草稿的 zod schema（headless UI 层试点 B：状态管理由 useState 迁到 useForm + zod）。
 *
 * 约束原则：目前唯一的硬性必填是「名称」，其余字段维持原有宽松语义（自由字符串/数组，
 * 静默超时等数字项仍以 string 存在草稿中，提交时由 buildDialogRepairDto/numberValue 转换，
 * 迁移不改动这段既有转换逻辑，只把「谁持有 value」换成 RHF）。
 * 用 `satisfies z.ZodType<...>` 让 schema 结构与既有 TS 接口保持同步，接口改动时能在编译期发现遗漏字段。
 */
const escalationRuleSchema = z.object({
  description: z.string(),
  keywords: z.array(z.string()).optional(),
  emotions: z.array(z.string()).optional(),
  consecutiveMisses: z.number().optional(),
}) satisfies z.ZodType<EscalationRule>;

const dialogRepairDraftSchema = z.object({
  noInputPrompt: z.string(),
  noInputGiveUpPrompt: z.string(),
  noMatchPrompt: z.string(),
  noMatchGiveUpPrompt: z.string(),
  repeatAckPrompt: z.string(),
  holdAckPrompt: z.string(),
  questionRequestAckPrompt: z.string(),
  sttRetryPrompt: z.string(),
  sttGiveUpPrompt: z.string(),
  sideQuestionFallbackPrompt: z.string(),
  sideQuestionDeferPrompt: z.string(),
  sideQuestionBridge: z.enum(['natural', 'template']),
  sideQuestionBridgeTemplate: z.string(),
  sideQuestionResumePrompt: z.string(),
  sideQuestionAckEnabled: z.boolean(),
  sideQuestionAck: z.string(),
  silencePrompt: z.string(),
  silenceTimeoutMs: z.string(),
  maxSilenceRounds: z.string(),
  silenceAction: z.enum(['hangup', 'transfer']),
  silenceTransferPrompt: z.string(),
}) satisfies z.ZodType<DialogRepairDraft>;

const scenarioDraftSchema = z.object({
  id: z.string().optional(),
  scenario: z.string(),
  // 唯一的硬性必填字段：中文错误提示通过 FieldShell 的 role="alert" 展示。
  name: z.string().trim().min(1, '请填写场景名称'),
  description: z.string(),
  status: z.enum([ScenarioStatus.ACTIVE, ScenarioStatus.INACTIVE]),
  ttsVoice: z.string(),
  ttsVoiceCloneId: z.string(),
  ttsProvider: z.string(),
  ttsAge: z.string(),
  ttsSpeakingRate: z.string(),
  ttsPitch: z.string(),
  ttsStylePrompt: z.string(),
  ttsVoicePersona: z.string(),
  agentIdentity: z.string(),
  customIdentityTags: z.array(z.string()),
  communicationStyle: z.string(),
  customStyleTags: z.array(z.string()),
  communicationStylePrompt: z.string(),
  businessGoal: z.string(),
  llmConstraintsText: z.string(),
  systemPrompt: z.string(),
  greeting: z.string(),
  knowledgeBaseId: z.string(),
  allowedToolsText: z.string(),
  escalationRules: z.array(escalationRuleSchema),
  defaultFlowId: z.string(),
  dialogRepair: dialogRepairDraftSchema,
  updatedAt: z.string().optional(),
}) satisfies z.ZodType<ScenarioDraft>;

const EMPTY_DIALOG_REPAIR: DialogRepairDraft = {
  noInputPrompt: '',
  noInputGiveUpPrompt: '',
  noMatchPrompt: '',
  noMatchGiveUpPrompt: '',
  repeatAckPrompt: '',
  holdAckPrompt: '',
  questionRequestAckPrompt: '',
  sttRetryPrompt: '',
  sttGiveUpPrompt: '',
  sideQuestionFallbackPrompt: '',
  sideQuestionDeferPrompt: '',
  sideQuestionBridge: 'natural',
  sideQuestionBridgeTemplate: '',
  sideQuestionResumePrompt: '',
  sideQuestionAckEnabled: true,
  sideQuestionAck: '',
  silencePrompt: '',
  silenceTimeoutMs: '',
  maxSilenceRounds: '',
  silenceAction: 'hangup',
  silenceTransferPrompt: '',
};

const EMPTY_DRAFT: ScenarioDraft = {
  scenario: '',
  name: '',
  description: '',
  status: ScenarioStatus.ACTIVE,
  ttsVoice: 'Cherry',
  ttsVoiceCloneId: '',
  ttsProvider: 'qwen',
  ttsAge: '',
  ttsSpeakingRate: '',
  ttsPitch: '',
  ttsStylePrompt: '',
  ttsVoicePersona: getBuiltInVoicePersona('Cherry'),
  agentIdentity: '',
  customIdentityTags: [],
  communicationStyle: '',
  customStyleTags: [],
  communicationStylePrompt: '',
  businessGoal: '',
  llmConstraintsText: '',
  systemPrompt: '',
  greeting: '',
  knowledgeBaseId: '',
  allowedToolsText: '',
  escalationRules: [],
  defaultFlowId: '',
  dialogRepair: { ...EMPTY_DIALOG_REPAIR },
};

const IDENTITY_PRESETS = ['游戏推广员', '活动运营员', '医疗助理', '审计专员', '保险专员', '行政助理'];
const STYLE_PRESETS = ['亲切', '自然', '口语化', '专业', '活泼', '严肃'];
const BUILT_IN_VOICE_PREFIX = 'builtin:';
const CLONED_VOICE_PREFIX = 'clone:';
const DEFAULT_PREVIEW_TEXT = '您好，这是一段场景语音试听，请确认当前音色是否符合预期。';

function splitCommunicationStyles(value: string): string[] {
  return value
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleCommunicationStyle(value: string, style: string): string {
  const selected = splitCommunicationStyles(value);
  const next = selected.includes(style)
    ? selected.filter((item) => item !== style)
    : [...selected, style];
  return next.join('、');
}

function isSelectablePublishedFlow(flow: TaskFlow): boolean {
  return flow.status === FlowStatus.PUBLISHED || flow.version > 0;
}

function withCacheBust(url: string | undefined, token: string | undefined): string | undefined {
  if (!url) return undefined;
  const separator = url.includes('?') ? '&' : '?';
  return token ? `${url}${separator}v=${encodeURIComponent(token)}` : url;
}

function emptyDraft(): ScenarioDraft {
  return {
    ...EMPTY_DRAFT,
    escalationRules: [],
    customIdentityTags: [],
    customStyleTags: [],
    dialogRepair: { ...EMPTY_DIALOG_REPAIR },
  };
}

/** 把新增的自定义标签值并入既有自定义标签列表（内置预设值不重复计入）。 */
function mergeCustomTags(existing: string[], builtIn: string[], values: string[]): string[] {
  const merged = [...existing];
  for (const value of values) {
    if (value && !builtIn.includes(value) && !merged.includes(value)) merged.push(value);
  }
  return merged;
}

function toDialogRepairDraft(config?: DialogRepairConfig): DialogRepairDraft {
  return {
    noInputPrompt: config?.noInputPrompt ?? '',
    noInputGiveUpPrompt: config?.noInputGiveUpPrompt ?? '',
    noMatchPrompt: config?.noMatchPrompt ?? '',
    noMatchGiveUpPrompt: config?.noMatchGiveUpPrompt ?? '',
    repeatAckPrompt: config?.repeatAckPrompt ?? '',
    holdAckPrompt: config?.holdAckPrompt ?? '',
    questionRequestAckPrompt: config?.questionRequestAckPrompt ?? '',
    sttRetryPrompt: config?.sttRetryPrompt ?? '',
    sttGiveUpPrompt: config?.sttGiveUpPrompt ?? '',
    sideQuestionFallbackPrompt: config?.sideQuestionFallbackPrompt ?? '',
    sideQuestionDeferPrompt: config?.sideQuestionDeferPrompt ?? '',
    sideQuestionBridge: config?.sideQuestionBridge ?? 'natural',
    sideQuestionBridgeTemplate: config?.sideQuestionBridgeTemplate ?? '',
    sideQuestionResumePrompt: config?.sideQuestionResumePrompt ?? '',
    // 插话应答语三态回显：保存值为 ""（显式禁用）→ 复选框不勾；
    // 非空 → 勾选并回填文本；未配置 → 勾选 + 空文本（= 运行时默认）。
    sideQuestionAckEnabled: config?.sideQuestionAck !== '',
    sideQuestionAck: config?.sideQuestionAck ?? '',
    silencePrompt: config?.silencePrompt ?? '',
    silenceTimeoutMs: config?.silenceTimeoutMs !== undefined ? String(config.silenceTimeoutMs) : '',
    maxSilenceRounds: config?.maxSilenceRounds !== undefined ? String(config.maxSilenceRounds) : '',
    silenceAction: config?.silenceAction ?? 'hangup',
    silenceTransferPrompt: config?.silenceTransferPrompt ?? '',
  };
}

function toDraft(scenario?: ScenarioConfig): ScenarioDraft {
  if (!scenario) return emptyDraft();
  return {
    id: scenario.id,
    scenario: scenario.scenario ?? '',
    name: scenario.name ?? '',
    description: scenario.description ?? '',
    status: scenario.status ?? ScenarioStatus.ACTIVE,
    ttsVoice: scenario.ttsConfig?.voice ?? '',
    ttsVoiceCloneId: scenario.ttsConfig?.voiceCloneId ?? '',
    ttsProvider: scenario.ttsConfig?.provider
      ?? (scenario.ttsConfig?.voice && !scenario.ttsConfig.voiceCloneId ? 'qwen' : ''),
    ttsAge: scenario.ttsConfig?.age ?? '',
    ttsSpeakingRate: scenario.ttsConfig?.speakingRate !== undefined ? String(scenario.ttsConfig.speakingRate) : '',
    ttsPitch: scenario.ttsConfig?.pitch !== undefined ? String(scenario.ttsConfig.pitch) : '',
    ttsStylePrompt: scenario.ttsConfig?.stylePrompt ?? '',
    ttsVoicePersona: scenario.ttsConfig?.voicePersona ?? '',
    agentIdentity: scenario.agentIdentity ?? '',
    // 已保存场景中不在内置列表里的身份/风格值，回显为可删除的自定义标签
    customIdentityTags: mergeCustomTags([], IDENTITY_PRESETS, [scenario.agentIdentity ?? '']),
    communicationStyle: scenario.communicationStyle ?? '',
    customStyleTags: mergeCustomTags([], STYLE_PRESETS, splitCommunicationStyles(scenario.communicationStyle ?? '')),
    communicationStylePrompt: scenario.communicationStylePrompt ?? '',
    businessGoal: scenario.businessGoal ?? '',
    llmConstraintsText: (scenario.llmConstraints ?? []).join('\n'),
    systemPrompt: scenario.systemPrompt ?? '',
    greeting: scenario.greeting ?? '',
    knowledgeBaseId: scenario.knowledgeBaseId ?? '',
    allowedToolsText: (scenario.allowedTools ?? []).join('\n'),
    escalationRules: (scenario.escalationRules ?? []).map((item) => ({ ...item })),
    defaultFlowId: scenario.defaultFlowId ?? '',
    dialogRepair: toDialogRepairDraft(scenario.dialogRepair),
    updatedAt: scenario.updatedAt,
  };
}

function splitLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberValue(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createScenarioKey(name: string) {
  const readable = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return readable || `scene_${Date.now().toString(36)}`;
}

/**
 * 将对话修复话术草稿转换为提交 payload。
 * 若所有字段均留空（沿用默认承接方式 natural、默认静默动作 hangup 且未填任何文案/数字），
 * 则省略该字段，交由 voice-agent 运行时使用内置默认文案。
 * 例外：取消勾选「插话时先播应答语」时 sideQuestionAck 提交 ""（显式禁用），
 * 此时视为存在自定义配置，不会整体省略。
 * 静默超时/轮数为数字字段，草稿中以 string 存储，此处转换为 number，非法值（空/非数字）一律省略。
 */
function buildDialogRepairDto(draft: DialogRepairDraft): DialogRepairConfig | undefined {
  const trimmed: DialogRepairConfig = {
    noInputPrompt: draft.noInputPrompt.trim() || undefined,
    noInputGiveUpPrompt: draft.noInputGiveUpPrompt.trim() || undefined,
    noMatchPrompt: draft.noMatchPrompt.trim() || undefined,
    noMatchGiveUpPrompt: draft.noMatchGiveUpPrompt.trim() || undefined,
    repeatAckPrompt: draft.repeatAckPrompt.trim() || undefined,
    holdAckPrompt: draft.holdAckPrompt.trim() || undefined,
    questionRequestAckPrompt: draft.questionRequestAckPrompt.trim() || undefined,
    sttRetryPrompt: draft.sttRetryPrompt.trim() || undefined,
    sttGiveUpPrompt: draft.sttGiveUpPrompt.trim() || undefined,
    sideQuestionFallbackPrompt: draft.sideQuestionFallbackPrompt.trim() || undefined,
    sideQuestionDeferPrompt: draft.sideQuestionDeferPrompt.trim() || undefined,
    sideQuestionBridgeTemplate: draft.sideQuestionBridgeTemplate.trim() || undefined,
    sideQuestionResumePrompt: draft.sideQuestionResumePrompt.trim() || undefined,
    // 插话应答语三态：取消勾选 → 提交 ""（显式禁用，运行时不播过渡语）；
    // 勾选且有文本 → 提交文本；勾选且留空 → 省略该键（沿用运行时默认文案）。
    sideQuestionAck: draft.sideQuestionAckEnabled
      ? draft.sideQuestionAck.trim() || undefined
      : '',
    silencePrompt: draft.silencePrompt.trim() || undefined,
    silenceTimeoutMs: numberValue(draft.silenceTimeoutMs),
    maxSilenceRounds: numberValue(draft.maxSilenceRounds),
    silenceTransferPrompt: draft.silenceTransferPrompt.trim() || undefined,
  };
  const hasCustomText = Object.values(trimmed).some((value) => value !== undefined);
  const hasCustomBridge = draft.sideQuestionBridge !== 'natural';
  const hasCustomSilenceAction = draft.silenceAction !== 'hangup';
  if (!hasCustomText && !hasCustomBridge && !hasCustomSilenceAction) return undefined;
  return {
    ...trimmed,
    sideQuestionBridge: draft.sideQuestionBridge,
    silenceAction: draft.silenceAction,
  };
}

function draftToDto(draft: ScenarioDraft): CreateScenarioDto {
  return {
    scenario: draft.scenario.trim() || createScenarioKey(draft.name),
    name: draft.name.trim(),
    description: draft.description,
    status: draft.status,
    ttsConfig: {
      voice: draft.ttsVoice || undefined,
      voiceCloneId: draft.ttsVoiceCloneId || undefined,
      provider: draft.ttsProvider || undefined,
      age: draft.ttsAge || undefined,
      speakingRate: numberValue(draft.ttsSpeakingRate),
      pitch: numberValue(draft.ttsPitch),
      stylePrompt: draft.ttsStylePrompt || undefined,
      voicePersona: draft.ttsVoicePersona.trim() || undefined,
    },
    agentIdentity: draft.agentIdentity,
    communicationStyle: draft.communicationStyle,
    communicationStylePrompt: draft.communicationStyle || undefined,
    businessGoal: draft.businessGoal,
    llmConstraints: splitLines(draft.llmConstraintsText),
    greeting: draft.greeting,
    escalationRules: draft.escalationRules,
    defaultFlowId: draft.defaultFlowId || undefined,
    dialogRepair: buildDialogRepairDto(draft.dialogRepair),
  };
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

/** 场景是否处于启用状态；未设置状态时按启用处理（与后端默认一致）。 */
function isScenarioActive(status?: ScenarioStatus): boolean {
  return status !== ScenarioStatus.INACTIVE;
}

function statusLabel(status?: ScenarioStatus) {
  return isScenarioActive(status) ? '启用' : '停用';
}

function BadgeStatus({ status }: { status?: ScenarioStatus }) {
  const active = isScenarioActive(status);
  return (
    <span className={`badge badge-dot ${active ? 'badge-success' : 'badge-neutral'}`}>
      {statusLabel(status)}
    </span>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <ScenarioTab active={active} onClick={onClick}>
      {children}
    </ScenarioTab>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="scenario-field-row">
      <label className="scenario-field-label">{label}</label>
      <div className="scenario-field-control">{children}</div>
    </div>
  );
}

function CountedInput({
  value,
  maxLength,
  onChange,
  placeholder,
}: {
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="scenario-counted-field">
      <input
        className="form-input"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <span>{value.length}/{maxLength}</span>
    </div>
  );
}

function CountedTextarea({
  value,
  maxLength,
  onChange,
  minHeight = 132,
}: {
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  minHeight?: number;
}) {
  return (
    <div className="scenario-counted-field textarea">
      <textarea
        className="form-textarea"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        style={{ minHeight }}
      />
      <span>{value.length}/{maxLength}</span>
    </div>
  );
}

/**
 * 标签组的「+ 新增」入口：点击后原地变为可输入的小输入框并自动 focus，
 * 回车或失焦时确认新增（空值则取消），Esc 取消编辑。
 */
function AddTagChip({ onAdd }: { onAdd: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function confirm() {
    const trimmed = value.trim();
    setEditing(false);
    setValue('');
    if (trimmed) onAdd(trimmed);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="scenario-chip-input"
        value={value}
        placeholder="输入后回车确认"
        onChange={(event) => setValue(event.target.value)}
        onBlur={confirm}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            confirm();
          }
          if (event.key === 'Escape') {
            setEditing(false);
            setValue('');
          }
        }}
      />
    );
  }

  return (
    <button type="button" className="scenario-chip scenario-chip-add" onClick={() => setEditing(true)}>
      + 新增
    </button>
  );
}

/** 单个标签：内置标签仅可选中，自定义标签额外带 × 可删除。 */
function TagChip({
  label,
  active,
  removable,
  onSelect,
  onRemove,
}: {
  label: string;
  active: boolean;
  removable: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <span className={`scenario-chip-slot ${removable ? 'removable' : ''}`}>
      <button
        type="button"
        className={`scenario-chip ${active ? 'selected' : ''}`}
        aria-pressed={active}
        onClick={onSelect}
      >
        {label}
      </button>
      {removable && (
        <button type="button" className="scenario-chip-remove" aria-label={`删除标签 ${label}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

/**
 * 「身份」标签组：内置 IDENTITY_PRESETS 单选 + 自定义标签新增/删除。
 * 迁移说明：不再走 draft/setDraft props，改从 useFormContext 读写（FormProvider 挂在
 * ScenarioDetailView 外层），读用 useWatch，写用 setValue —— 避免逐层透传两个 props。
 */
function IdentityChips() {
  const { control, setValue } = useFormContext<ScenarioDraft>();
  const agentIdentity = useWatch({ control, name: 'agentIdentity' });
  const customIdentityTags = useWatch({ control, name: 'customIdentityTags' });
  const customTags = customIdentityTags.filter((tag) => !IDENTITY_PRESETS.includes(tag));
  const allTags = [...IDENTITY_PRESETS, ...customTags];

  return (
    <div className="scenario-chip-list" role="group" aria-label="身份（单选）">
      {allTags.map((tag) => (
        <TagChip
          key={tag}
          label={tag}
          active={agentIdentity === tag}
          removable={!IDENTITY_PRESETS.includes(tag)}
          onSelect={() => setValue('agentIdentity', tag, { shouldDirty: true })}
          onRemove={() => {
            setValue('agentIdentity', agentIdentity === tag ? '' : agentIdentity, { shouldDirty: true });
            setValue(
              'customIdentityTags',
              customIdentityTags.filter((item) => item !== tag),
              { shouldDirty: true },
            );
          }}
        />
      ))}
      <AddTagChip
        onAdd={(value) => {
          // agentIdentity 没有 zod 校验规则，不需要 shouldValidate（避免触发一次多余的异步 resolver）。
          setValue('agentIdentity', value, { shouldDirty: true });
          setValue(
            'customIdentityTags',
            mergeCustomTags(customIdentityTags, IDENTITY_PRESETS, [value]),
            { shouldDirty: true },
          );
        }}
      />
    </div>
  );
}

/** 「沟通风格」标签组：内置 STYLE_PRESETS 多选 + 自定义标签新增/删除。同上改走 useFormContext。 */
function StyleChips() {
  const { control, setValue } = useFormContext<ScenarioDraft>();
  const communicationStyle = useWatch({ control, name: 'communicationStyle' });
  const customStyleTags = useWatch({ control, name: 'customStyleTags' });
  const selected = splitCommunicationStyles(communicationStyle);
  const customTags = customStyleTags.filter((tag) => !STYLE_PRESETS.includes(tag));
  const allTags = [...STYLE_PRESETS, ...customTags];

  return (
    <div className="scenario-chip-list" role="group" aria-label="沟通风格（可多选）">
      {allTags.map((tag) => (
        <TagChip
          key={tag}
          label={tag}
          active={selected.includes(tag)}
          removable={!STYLE_PRESETS.includes(tag)}
          onSelect={() => setValue(
            'communicationStyle',
            toggleCommunicationStyle(communicationStyle, tag),
            { shouldDirty: true },
          )}
          onRemove={() => {
            setValue(
              'communicationStyle',
              splitCommunicationStyles(communicationStyle).filter((item) => item !== tag).join('、'),
              { shouldDirty: true },
            );
            setValue(
              'customStyleTags',
              customStyleTags.filter((item) => item !== tag),
              { shouldDirty: true },
            );
          }}
        />
      ))}
      <AddTagChip
        onAdd={(value) => {
          const current = splitCommunicationStyles(communicationStyle);
          const nextSelected = current.includes(value) ? current : [...current, value];
          setValue('communicationStyle', nextSelected.join('、'), { shouldDirty: true });
          setValue(
            'customStyleTags',
            mergeCustomTags(customStyleTags, STYLE_PRESETS, [value]),
            { shouldDirty: true },
          );
        }}
      />
    </div>
  );
}

/**
 * 「行业模板」选择：点击某个行业模板标签，把模板预设内容整体回显进当前草稿
 * （身份/沟通风格/业务目标/系统提示词/回复边界/开场白），仅覆盖草稿，不自动保存。
 * 迁移说明：改用逐字段 setValue 批量写入，而非 reset() —— reset() 会整体替换表单值，
 * 若只想覆盖模板涉及的几个字段需先 getValues() 合并，反而更绕；逐字段 setValue 更直接、
 * 也不会影响未涉及字段的 dirty 状态。
 */
function IndustryTemplateSection() {
  const { getValues, setValue } = useFormContext<ScenarioDraft>();

  function applyTemplate(template: ScenarioIndustryTemplate) {
    const prevCustomIdentityTags = getValues('customIdentityTags');
    const prevCustomStyleTags = getValues('customStyleTags');
    setValue('agentIdentity', template.agentIdentity, { shouldDirty: true });
    setValue(
      'customIdentityTags',
      mergeCustomTags(prevCustomIdentityTags, IDENTITY_PRESETS, [template.agentIdentity]),
      { shouldDirty: true },
    );
    setValue('communicationStyle', template.communicationStyle, { shouldDirty: true });
    setValue(
      'customStyleTags',
      mergeCustomTags(prevCustomStyleTags, STYLE_PRESETS, splitCommunicationStyles(template.communicationStyle)),
      { shouldDirty: true },
    );
    setValue('businessGoal', template.businessGoal, { shouldDirty: true });
    setValue('systemPrompt', template.systemPrompt, { shouldDirty: true });
    setValue('llmConstraintsText', template.llmConstraints.join('\n'), { shouldDirty: true });
    setValue('greeting', template.greeting, { shouldDirty: true });
    appToast.info(`已应用「${template.name}」行业模板`);
  }

  return (
    <section className="scenario-section">
      <h2>行业模板</h2>
      <div className="scenario-chip-list" role="group" aria-label="行业模板">
        {SCENARIO_INDUSTRY_TEMPLATES.map((template) => (
          <button
            key={template.key}
            type="button"
            className="scenario-chip"
            title={template.description}
            onClick={() => applyTemplate(template)}
          >
            {template.name}
          </button>
        ))}
      </div>
      <span className="scenario-field-hint">
        选择行业模板可快速填充身份、沟通风格、业务目标等内容，仍可在下方继续调整；不会自动保存。
      </span>
    </section>
  );
}

function ScenarioListView({
  scenarios,
  isLoading,
  onCreate,
  onEdit,
  onDeactivate,
  onPublish,
}: {
  scenarios: ScenarioConfig[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (scenario: ScenarioConfig) => void;
  onDeactivate: (scenario: ScenarioConfig) => void;
  onPublish: (scenario: ScenarioConfig) => void;
}) {
  const canWrite = usePermission(PERMISSIONS.SCENARIO_UPDATE);
  // 发布/停用直接发起网络请求，且列表行按钮没有 pending/disabled 保护，
  // 用节流防止连点导致重复请求（同一动作在所有行间共享节流窗口）。
  const throttledPublish = useThrottleFn(onPublish);
  const throttledDeactivate = useThrottleFn(onDeactivate);
  const [query, setQuery] = useState('');
  const filtered = scenarios.filter((item) => {
    const text = `${item.name} ${item.scenario} ${item.description}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  return (
    <div className={styles.workbench}>
      <ScenarioPageTitle title="场景配置" breadcrumb="智能外呼 / 场景配置" />

      <ScenarioTabs>
        <ScenarioTab active>场景列表</ScenarioTab>
        {/* <ScenarioTab>测试记录</ScenarioTab> */}
      </ScenarioTabs>

      {/* <div className="scenario-guide">
        <div className="scenario-guide-title">创建方式</div>
        <div className="scenario-guide-steps">
          <div className="scenario-guide-step">
            <div className="scenario-guide-icon">1</div>
            <div>
              <div className="scenario-guide-step-title">步骤1：新建场景</div>
              <p>从场景名称开始，逐步补充身份、风格和业务目标。</p>
            </div>
          </div>
          <div className="scenario-guide-step">
            <div className="scenario-guide-icon">2</div>
            <div>
              <div className="scenario-guide-step-title">步骤2：配置场景内容</div>
              <p>配置机器人身份、业务目标、回复边界和外呼流程。</p>
            </div>
          </div>
          <div className="scenario-guide-step">
            <div className="scenario-guide-icon">3</div>
            <div>
              <div className="scenario-guide-step-title">步骤3：调试并发布场景</div>
              <p>通过语音调试或测试记录验证效果，发布后即可用于外呼任务。</p>
            </div>
          </div>
        </div>
      </div> */}

      <div className="scenario-toolbar">
        {canWrite && (
          <button type="button" className="btn" onClick={onCreate}>
            <Plus size={15} />
            新建场景
          </button>
        )}
        <div className="scenario-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="请输入场景名称搜索" />
          <Search size={15} />
        </div>
        <button type="button" className="btn btn-secondary btn-icon" onClick={() => location.reload()} title="刷新">
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="table-wrap scenario-table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>说明</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>最近更新时间</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((scenario) => (
                <tr key={scenario.id ?? scenario.scenario}>
                  <td style={{ fontWeight: 500 }}>{scenario.name}</td>
                  <td className="text-secondary">{scenario.description || '-'}</td>
                  <td><BadgeStatus status={scenario.status} /></td>
                  <td className="text-secondary">{formatDate(scenario.createdAt)}</td>
                  <td className="text-secondary">{formatDate(scenario.updatedAt)}</td>
                  <td>
                    <div className="scenario-row-actions">
                      <button type="button" onClick={() => onEdit(scenario)}>进入</button>
                      {/* <Link href={`/scenarios/${scenario.id ?? scenario.scenario}/tests`}>测试记录</Link> */}
                      {/* 「发布」「停用」与当前状态互斥：已启用的场景不再展示「发布」，已停用的不再展示「停用」 */}
                      {canWrite && !isScenarioActive(scenario.status) && (
                        <button type="button" onClick={() => throttledPublish(scenario)}>发布</button>
                      )}
                      {canWrite && isScenarioActive(scenario.status) && (
                        <button type="button" onClick={() => throttledDeactivate(scenario)}>停用</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty" style={{ padding: '34px 12px' }}>
                      <div className="empty-title">{isLoading ? '场景加载中' : '暂无匹配场景'}</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * 迁移说明：draft/setDraft 两个 props 已去掉，改为内部 useFormContext + useWatch/setValue。
 * 「名称」仍用 CountedInput（自带字符计数 UI，非 FormInput 能直接套皮，套皮会重复渲染 label），
 * 但校验错误改走 zod：formState.errors.name 有值时以 role="alert" 展示中文错误，
 * 替代原来「点保存 -> toast 提示请填写场景名称」的手动校验。
 */
function RobotConfigTab({ flows }: { flows: TaskFlow[] }) {
  const { control, setValue, formState } = useFormContext<ScenarioDraft>();
  const name = useWatch({ control, name: 'name' });
  const description = useWatch({ control, name: 'description' });
  const ttsAge = useWatch({ control, name: 'ttsAge' });
  const businessGoal = useWatch({ control, name: 'businessGoal' });
  const llmConstraintsText = useWatch({ control, name: 'llmConstraintsText' });
  const defaultFlowId = useWatch({ control, name: 'defaultFlowId' });
  const boundFlowUnavailable = Boolean(
    defaultFlowId && !flows.some((flow) => flow.id === defaultFlowId),
  );
  const nameError = formState.errors.name?.message;

  return (
    <>
      <IndustryTemplateSection />

      <section className="scenario-section">
        <h2>人物与风格</h2>
        <FieldRow label="名称">
          <CountedInput
            value={name}
            maxLength={100}
            onChange={(value) => setValue('name', value, { shouldDirty: true, shouldValidate: true })}
            placeholder="请输入场景名称"
          />
          {nameError && (
            <span className="scenario-field-hint" role="alert" style={{ color: 'var(--danger, #dc2626)' }}>
              {nameError}
            </span>
          )}
        </FieldRow>
        <FieldRow label="说明">
          <CountedInput
            value={description}
            maxLength={140}
            onChange={(value) => setValue('description', value, { shouldDirty: true })}
            placeholder="请输入场景说明"
          />
        </FieldRow>
        <FieldRow label="年龄">
          <div className="scenario-inline-input">
            <input
              className="form-input"
              value={ttsAge}
              onChange={(event) => setValue('ttsAge', event.target.value, { shouldDirty: true })}
            />
            <span>岁</span>
          </div>
        </FieldRow>
        <FieldRow label="身份">
          <IdentityChips />
          <span className="scenario-field-hint">
            点击标签单选身份；点击"+ 新增"添加自定义标签，自定义标签可点击 × 删除。
          </span>
        </FieldRow>
        <FieldRow label="沟通风格">
          <StyleChips />
          <span className="scenario-field-hint">
            可点选多个风格，再次点击可取消；点击"+ 新增"添加自定义标签，自定义标签可点击 × 删除。
          </span>
        </FieldRow>
      </section>

      <section className="scenario-section">
        <h2>业务描述</h2>
        <FieldRow label="目标">
          <CountedTextarea
            value={businessGoal}
            maxLength={1000}
            onChange={(value) => setValue('businessGoal', value, { shouldDirty: true })}
            minHeight={150}
          />
        </FieldRow>
        <FieldRow label="外呼任务流程">
          <div className="scenario-flow-row">
            <select
              className="form-select"
              value={boundFlowUnavailable ? '' : defaultFlowId}
              onChange={(event) => setValue('defaultFlowId', event.target.value, { shouldDirty: true })}
            >
              <option value="">不绑定流程</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name} v{flow.version}
                  {flow.status === FlowStatus.PUBLISHED ? '' : '（有草稿修改，绑定已发布版本）'}
                </option>
              ))}
            </select>
            <Link href="/task-flows" className="scenario-text-link">管理流程</Link>
          </div>
          <span className="scenario-field-hint">仅显示至少发布过一个版本的流程。</span>
          {boundFlowUnavailable && (
            <div className="scenario-inline-warning" role="alert">
              原绑定流程已不可用，请重新选择已发布流程，或
              <button
                type="button"
                onClick={() => setValue('defaultFlowId', '', { shouldDirty: true })}
              >
                解除原绑定
              </button>
              。
            </div>
          )}
        </FieldRow>
        <FieldRow label="回复边界">
          <CountedTextarea
            value={llmConstraintsText}
            maxLength={3000}
            onChange={(value) => setValue('llmConstraintsText', value, { shouldDirty: true })}
            minHeight={154}
          />
        </FieldRow>
      </section>

      <SilenceConfigSection />
      <SideQuestionSection />
    </>
  );
}

/**
 * 「静默处理」独立配置组。
 *
 * 数字项采用行内句式布局（"客户静默超过 [N] 毫秒…"、"连续静默 [N] 轮后 [动作]"），
 * 连续静默轮数与超限动作同一行。其余细分话术（没听懂/要求重复/各类收尾语等）
 * 不再暴露表单，一律使用运行时内置默认文案，但仍在 dialogRepair 草稿中透传，
 * 通过 API 配置的历史值不会丢失。
 */
function SilenceConfigSection() {
  const { control, setValue } = useFormContext<ScenarioDraft>();
  // dialogRepair 是行内多元素混排的自绘布局（句式 + 输入框 + 下拉同一行），
  // 直接套 FormInput/FormSelect 会额外插入一层块级 label 破坏行内排版，
  // 所以按「复杂自绘控件」处理：保持原 JSX，只把 useState 换成整个 dialogRepair 子树的
  // useWatch 读 + setValue 写（而非逐字段拆 useController），改动量最小。
  const repair = useWatch({ control, name: 'dialogRepair' });

  function update(patch: Partial<DialogRepairDraft>) {
    setValue('dialogRepair', { ...repair, ...patch }, { shouldDirty: true });
  }

  return (
    <section className="scenario-section">
      <h2>静默处理</h2>
      <FieldRow label="静默追问提示词">
        <textarea
          className="form-textarea"
          aria-label="静默追问提示词"
          value={repair.silencePrompt}
          placeholder={DIALOG_REPAIR_DEFAULTS.silencePrompt}
          onChange={(event) => update({ silencePrompt: event.target.value })}
          style={{ minHeight: 72 }}
        />
        <span className="scenario-field-hint">
          客户长时间不说话时，AI 按这里的要求生成追问；留空默认复述上一轮内容并自然衔接。
        </span>
      </FieldRow>

      <FieldRow label="静默判定">
        <div className="scenario-silence-row">
          <span>客户静默超过</span>
          <input
            type="number"
            className="form-input"
            aria-label="静默超时时间"
            value={repair.silenceTimeoutMs}
            placeholder="6000"
            onChange={(event) => update({ silenceTimeoutMs: event.target.value })}
          />
          <span>毫秒时，播报静默追问话术</span>
        </div>
        <span className="scenario-field-hint">留空默认 6 秒（6000 毫秒）。</span>
      </FieldRow>

      <FieldRow label="静默超限">
        <div className="scenario-silence-row">
          <span>连续静默超过</span>
          <input
            type="number"
            className="form-input"
            aria-label="连续静默轮数"
            value={repair.maxSilenceRounds}
            placeholder="2"
            onChange={(event) => update({ maxSilenceRounds: event.target.value })}
          />
          <span>轮时，执行</span>
          <select
            className="form-select"
            aria-label="静默超限动作"
            value={repair.silenceAction}
            onChange={(event) => update({
              silenceAction: event.target.value as DialogRepairDraft['silenceAction'],
            })}
          >
            <option value="hangup">礼貌结束通话（默认）</option>
            <option value="transfer">转人工</option>
          </select>
        </div>
        {repair.silenceAction === 'transfer' && (
          // 这里之前只有 aria-label、没有可见 label 文案，套 FormInput 不会产生重复 label，
          // 属于「简单文本字段」，实际换成了 FormInput 封装（非仅状态桥接）。
          <FormInput
            control={control}
            name="dialogRepair.silenceTransferPrompt"
            label="转人工提示语"
            placeholder={DIALOG_REPAIR_DEFAULTS.silenceTransferPrompt}
            style={{ marginTop: 8 }}
          />
        )}
      </FieldRow>
    </section>
  );
}

/**
 * 「插话处理」独立配置组：客户中途提问（插话）后如何回到主流程。
 * 与 SilenceConfigSection 同理，dialogRepair 子树整体 useWatch + setValue 桥接。
 */
function SideQuestionSection() {
  const { control, setValue } = useFormContext<ScenarioDraft>();
  const repair = useWatch({ control, name: 'dialogRepair' });

  function update(patch: Partial<DialogRepairDraft>) {
    setValue('dialogRepair', { ...repair, ...patch }, { shouldDirty: true });
  }

  return (
    <section className="scenario-section">
      <h2>插话处理</h2>
      <FieldRow label="插话应答语">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <input
            type="checkbox"
            aria-label="插话时先播应答语"
            checked={repair.sideQuestionAckEnabled}
            onChange={(event) => update({ sideQuestionAckEnabled: event.target.checked })}
          />
          <span>插话时先播应答语</span>
        </label>
        <input
          className="form-input"
          aria-label="插话应答语"
          value={repair.sideQuestionAck}
          disabled={!repair.sideQuestionAckEnabled}
          placeholder={DIALOG_REPAIR_DEFAULTS.sideQuestionAck}
          onChange={(event) => update({ sideQuestionAck: event.target.value })}
        />
        <span className="scenario-field-hint">
          {repair.sideQuestionAckEnabled
            ? '查询答案前先说的一句短话，留空用默认。'
            : '已关闭：插话时不播应答语，等答案生成后直接播报。'}
        </span>
      </FieldRow>
      <FieldRow label="插话后回到流程">
        <select
          className="form-select"
          aria-label="插话后回到流程"
          value={repair.sideQuestionBridge}
          onChange={(event) => update({
            sideQuestionBridge: event.target.value as DialogRepairDraft['sideQuestionBridge'],
          })}
        >
          <option value="natural">自然过渡（AI 回答客户问题后自己接回正题，默认）</option>
          <option value="template">固定话术（按下方模板复读原问题）</option>
        </select>
        {repair.sideQuestionBridge === 'natural' && (
          // 同上：原本只有 aria-label，没有可见 label，改用 FormTextarea 封装，
          // hint 直接用 FieldShell 自带的提示位，不再单独拼一个 span。
          <FormTextarea
            control={control}
            name="dialogRepair.sideQuestionResumePrompt"
            label="回到流程提示词"
            hint="AI 回答插话后，会按这段提示自然地把话题带回主流程；{question} 会自动替换为客户尚未回答的问题，留空使用系统默认提示词。"
            placeholder={DIALOG_REPAIR_DEFAULTS.sideQuestionResumePrompt}
            style={{ minHeight: 96, marginTop: 8 }}
          />
        )}
        {repair.sideQuestionBridge === 'template' && (
          <FormTextarea
            control={control}
            name="dialogRepair.sideQuestionBridgeTemplate"
            label="插话承接模板"
            hint="{question} 会自动替换成要回到的问题。"
            placeholder={DIALOG_REPAIR_DEFAULTS.sideQuestionBridgeTemplate}
            style={{ minHeight: 72, marginTop: 8 }}
          />
        )}
      </FieldRow>
    </section>
  );
}

/**
 * 迁移说明：音色选择/克隆试听属于「复杂自绘控件」，保留原实现不重写，
 * 只把 draft/setDraft 换成 useFormContext 的 watch/setValue；previewText 等纯本地
 * UI 态（试听文案、生成中/播放中状态）不属于提交草稿，继续留在组件本地 useState。
 */
function VoiceTab() {
  const { control, setValue } = useFormContext<ScenarioDraft>();
  const ttsVoice = useWatch({ control, name: 'ttsVoice' });
  const ttsVoiceCloneId = useWatch({ control, name: 'ttsVoiceCloneId' });
  const ttsStylePrompt = useWatch({ control, name: 'ttsStylePrompt' });
  const ttsVoicePersona = useWatch({ control, name: 'ttsVoicePersona' });
  const { data: voiceClones } = useVoiceClones();
  const { synthesize } = useVoiceCloneMutations();
  const tts = useTTS({ defaultSpeaker: ttsVoice || 'Cherry' });
  const clones = (voiceClones ?? []).filter((clone) => clone.status === VoiceCloneStatus.READY);
  const selectedClone = clones.find((clone) => clone.id === ttsVoiceCloneId);
  const selectedVoiceValue = selectedClone
    ? `${CLONED_VOICE_PREFIX}${selectedClone.id}`
    : isBuiltInTtsVoice(ttsVoice)
      ? `${BUILT_IN_VOICE_PREFIX}${ttsVoice}`
      : '';
  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW_TEXT);
  const [cloneGenerating, setCloneGenerating] = useState(false);
  const [clonePreviewUrl, setClonePreviewUrl] = useState<string>();
  const [previewError, setPreviewError] = useState<string>();
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const busy = cloneGenerating || tts.isBusy;

  useEffect(() => {
    if (!clonePreviewUrl) return;
    previewAudioRef.current?.play().catch(() => {
      // 浏览器可能阻止异步请求后的自动播放，音频控件仍可手动播放。
    });
  }, [clonePreviewUrl]);

  function selectVoice(value: string) {
    tts.stop();
    previewAudioRef.current?.pause();
    setClonePreviewUrl(undefined);
    setPreviewError(undefined);

    if (value.startsWith(BUILT_IN_VOICE_PREFIX)) {
      const voice = value.slice(BUILT_IN_VOICE_PREFIX.length);
      setValue('ttsVoice', voice, { shouldDirty: true });
      setValue('ttsVoiceCloneId', '', { shouldDirty: true });
      setValue('ttsProvider', 'qwen', { shouldDirty: true });
      setValue('ttsVoicePersona', getBuiltInVoicePersona(voice), { shouldDirty: true });
      return;
    }

    if (value.startsWith(CLONED_VOICE_PREFIX)) {
      const cloneId = value.slice(CLONED_VOICE_PREFIX.length);
      const clone = clones.find((item) => item.id === cloneId);
      if (!clone) return;
      setValue('ttsVoice', clone.voiceId, { shouldDirty: true });
      setValue('ttsVoiceCloneId', clone.id, { shouldDirty: true });
      setValue('ttsProvider', clone.model, { shouldDirty: true });
      setValue('ttsVoicePersona', '', { shouldDirty: true });
      return;
    }

    setValue('ttsVoice', '', { shouldDirty: true });
    setValue('ttsVoiceCloneId', '', { shouldDirty: true });
    setValue('ttsProvider', '', { shouldDirty: true });
    setValue('ttsVoicePersona', '', { shouldDirty: true });
  }

  async function generatePreview() {
    const text = previewText.trim();
    if (!text) {
      appToast.error(new Error('请输入试听文案'));
      return;
    }
    if (!selectedVoiceValue) {
      appToast.error(new Error('请选择语音音色'));
      return;
    }

    setPreviewError(undefined);
    if (selectedClone) {
      tts.stop();
      setCloneGenerating(true);
      try {
        const result = await synthesize(selectedClone.id, { text });
        const url = withCacheBust(
          result.voiceClone.previewAudioUrl,
          result.voiceClone.previewGeneratedAt ?? result.voiceClone.updatedAt,
        );
        if (!url) throw new Error('试听音频生成成功，但未返回可播放地址');
        setClonePreviewUrl(url);
        if (result.usedFallback) appToast.info(result.message ?? '已使用提示音频作为试听');
      } catch (error) {
        const message = error instanceof Error ? error.message : '克隆音色试听生成失败';
        setPreviewError(message);
        appToast.error(error);
      } finally {
        setCloneGenerating(false);
      }
      return;
    }

    setClonePreviewUrl(undefined);
    await tts.speak(text, {
      speaker: ttsVoice,
      instructText: ttsStylePrompt.trim() || undefined,
    });
  }

  return (
    <section className="scenario-section">
      <h2>语音与 VUI</h2>
      <FieldRow label="语音音色">
        <div className="scenario-voice-select-row">
          <select
            className="form-select"
            aria-label="语音音色"
            value={selectedVoiceValue}
            onChange={(event) => selectVoice(event.target.value)}
          >
            <option value="">请选择语音音色</option>
            <optgroup label="TTS 内置音色">
              {BUILT_IN_TTS_VOICES.map((voice) => (
                <option key={voice.id} value={`${BUILT_IN_VOICE_PREFIX}${voice.id}`}>
                  {voice.id} · {voice.description}
                </option>
              ))}
            </optgroup>
            {clones.length > 0 && (
              <optgroup label="已克隆音色">
                {clones.map((clone) => (
                  <option key={clone.id} value={`${CLONED_VOICE_PREFIX}${clone.id}`}>
                    {clone.name} · {clone.voiceId}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <Link href="/voice-clones" className="scenario-text-link">管理克隆音色</Link>
        </div>
      </FieldRow>
      <FieldRow label="音色人设">
        <div className="scenario-counted-field textarea">
          <textarea
            className="form-textarea"
            aria-label="音色人设"
            value={ttsVoicePersona}
            maxLength={300}
            onChange={(event) => setValue('ttsVoicePersona', event.target.value, { shouldDirty: true })}
            placeholder="描述该音色的人设与说话风格，AI 生成话术时会依据它调整语气措辞（选择内置音色时自动填入，可修改）"
            style={{ minHeight: 72 }}
          />
          <span>{ttsVoicePersona.length}/300</span>
        </div>
      </FieldRow>
      <FieldRow label="音色试听">
        <div className="scenario-voice-preview">
          <div className="scenario-preview-heading">
            <span className="scenario-preview-icon"><Headphones size={16} /></span>
            <div>
              <strong>输入一段真实话术</strong>
              <span>将使用当前选择的音色生成试听语音</span>
            </div>
          </div>
          <div className="scenario-counted-field textarea">
            <textarea
              className="form-textarea"
              aria-label="试听文案"
              value={previewText}
              maxLength={500}
              onChange={(event) => setPreviewText(event.target.value)}
              placeholder="请输入需要生成语音的试听文案"
              style={{ minHeight: 112 }}
            />
            <span>{previewText.length}/500</span>
          </div>
          <div className="scenario-preview-actions">
            <button
              type="button"
              className="btn"
              onClick={generatePreview}
              disabled={busy || !previewText.trim() || !selectedVoiceValue}
            >
              {busy ? <LoaderCircle size={15} className="scenario-spin" /> : <Volume2 size={15} />}
              {cloneGenerating || tts.state === 'synthesizing'
                ? '正在生成...'
                : tts.state === 'playing'
                  ? '播放中'
                  : '生成并试听'}
            </button>
            {tts.isBusy && !selectedClone && (
              <button type="button" className="btn btn-secondary" onClick={tts.stop}>
                <Square size={13} />
                停止播放
              </button>
            )}
            <span className="scenario-preview-current">
              当前：{selectedClone?.name || ttsVoice || '未选择'}
            </span>
          </div>
          {clonePreviewUrl && (
            <audio
              ref={previewAudioRef}
              className="scenario-preview-audio"
              src={clonePreviewUrl}
              controls
              preload="metadata"
            />
          )}
          {(previewError || tts.error) && (
            <div className="scenario-preview-error" role="alert">{previewError ?? tts.error}</div>
          )}
        </div>
      </FieldRow>
      {/* 「声音风格」「开场白模板」两个表单字段已按需求移除展示，
          draft.ttsStylePrompt / draft.greeting 仍随草稿透传提交，不影响已保存的值。 */}
    </section>
  );
}

function ScenarioDetailView({
  flows,
  mode,
  submitting,
  onBack,
  onSave,
}: {
  flows: TaskFlow[];
  mode: 'create' | 'edit';
  submitting: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const canWrite = usePermission(PERMISSIONS.SCENARIO_UPDATE);
  const [tab, setTab] = useState<DetailTab>('robot');
  // draft/setDraft 已下放为 FormProvider（挂在调用方 ScenariosPage），这里只读展示用的两个字段。
  const { control } = useFormContext<ScenarioDraft>();
  const name = useWatch({ control, name: 'name' });
  const updatedAt = useWatch({ control, name: 'updatedAt' });

  return (
    <div className={cn(styles.workbench, styles.detail)}>
      <ScenarioPageTitle
        title="大模型场景管理详情"
        breadcrumb={<>智能外呼 / 场景管理 / {name || '新建场景'} / 大模型场景管理详情</>}
        onBack={onBack}
        backLabel="返回列表"
        extra={(
          <button
            type="button"
            className="scenario-debug-toggle"
            onClick={() => setTab('voice')}
            aria-pressed={tab === 'voice'}
          >
            <Volume2 size={15} />
            <span>语音试听</span>
          </button>
        )}
      />

      <ScenarioTabs>
        <TabButton active={tab === 'robot'} onClick={() => setTab('robot')}>机器人配置</TabButton>
        <TabButton active={tab === 'voice'} onClick={() => setTab('voice')}>语音&VUI</TabButton>
      </ScenarioTabs>

      <div className="scenario-detail-body">
        {tab === 'robot' && <RobotConfigTab flows={flows} />}
        {tab === 'voice' && <VoiceTab />}
      </div>

      <div className="scenario-save-bar">
        {canWrite && (
          <button type="button" className="btn" onClick={onSave} disabled={submitting}>
            <Save size={15} />
            {submitting ? '保存中...' : '保存'}
          </button>
        )}
        <span>最近保存：{mode === 'create' ? '-' : formatDate(updatedAt)}</span>
      </div>
    </div>
  );
}

export default function ScenariosPage() {
  const { data, error, isLoading } = useScenarios();
  const { data: flowsData } = useTaskFlows();
  const flows = useMemo(
    () => (flowsData ?? []).filter(isSelectablePublishedFlow),
    [flowsData],
  );
  const scenarios = data ?? [];
  const { create, update, deactivate } = useScenarioMutations();
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [mode, setMode] = useState<'create' | 'edit'>('edit');
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // 草稿状态管理迁到 useForm + zod（headless UI 层试点 B）：defaultValues 只在挂载时生效一次，
  // 「切换场景/新建/保存成功后回填」这类整体替换草稿的场景，改用下面的 reset() 承担，
  // 与原来 setDraft(整份新草稿) 语义一致。
  const form = useForm<ScenarioDraft>({
    resolver: zodResolver(scenarioDraftSchema),
    defaultValues: emptyDraft(),
  });
  const { reset, handleSubmit } = form;

  const selectedScenario = useMemo(
    () => scenarios.find((item) => (item.id ?? item.scenario) === selectedKey),
    [scenarios, selectedKey],
  );

  useEffect(() => {
    if (view !== 'detail') return;
    reset(mode === 'create' ? emptyDraft() : toDraft(selectedScenario));
  }, [mode, selectedScenario, view, reset]);

  function openCreate() {
    setMode('create');
    setSelectedKey('');
    reset(emptyDraft());
    setView('detail');
  }

  function openEdit(scenario: ScenarioConfig) {
    setMode('edit');
    setSelectedKey(scenario.id ?? scenario.scenario);
    reset(toDraft(scenario));
    setView('detail');
  }

  /**
   * 提交回调：只在 zod 校验（如「名称」必填）通过后才会被 handleSubmit 调用，
   * 名称校验错误改由 RobotConfigTab 内联展示（role="alert"），不再走这里的手动 toast。
   * 「外呼流程只能绑定已发布版本」依赖运行时拉取的 flows 列表，zod schema 不掌握这份外部数据，
   * 保留为提交前的手动检查。
   */
  async function onValidSubmit(values: ScenarioDraft) {
    const dto = draftToDto(values);
    if (values.defaultFlowId && !flows.some((flow) => flow.id === values.defaultFlowId)) {
      appToast.error(new Error('外呼流程只能绑定已发布的版本'));
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const created = await create(dto);
        setMode('edit');
        setSelectedKey(created.id ?? created.scenario);
        reset(toDraft(created));
        appToast.success('场景已创建');
      } else {
        const saved = await update(values.id ?? (selectedKey || values.scenario), {
          ...dto,
          // 编辑保存必须显式携带 dialogRepair：全空时送 {}（后端把空对象归一化为「未配置」）。
          // 若沿用 undefined，JSON 序列化会丢 key，PATCH 会跳过该字段的写入，
          // 导致清空后旧配置残留、无法从 UI 恢复运行时默认（新建路径保持省略不变）。
          dialogRepair: dto.dialogRepair ?? {},
          defaultFlowId: values.defaultFlowId || null,
        });
        setSelectedKey(saved.id ?? saved.scenario);
        reset(toDraft(saved));
        appToast.success('场景已保存');
      }
    } catch (err) {
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(scenario: ScenarioConfig) {
    setSubmitting(true);
    try {
      await deactivate(scenario.id ?? scenario.scenario);
      appToast.success('场景已停用');
    } catch (err) {
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish(scenario: ScenarioConfig) {
    setSubmitting(true);
    try {
      await update(scenario.id ?? scenario.scenario, { status: ScenarioStatus.ACTIVE });
      appToast.success('场景已发布');
    } catch (err) {
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-title" style={{ color: 'var(--danger)' }}>场景加载失败</div>
          <div className="empty-desc">{error instanceof Error ? error.message : '请检查后端服务'}</div>
        </div>
      </div>
    );
  }

  if (view === 'detail') {
    return (
      <FormProvider {...form}>
        <ScenarioDetailView
          flows={flows}
          mode={mode}
          submitting={submitting}
          onBack={() => setView('list')}
          onSave={handleSubmit(onValidSubmit)}
        />
      </FormProvider>
    );
  }

  return (
    <ScenarioListView
      scenarios={scenarios}
      isLoading={isLoading}
      onCreate={openCreate}
      onEdit={openEdit}
      onDeactivate={handleDeactivate}
      onPublish={handlePublish}
    />
  );
}
