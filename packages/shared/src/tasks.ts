import type { ScenarioConfig, ScenarioKey } from './scenarios.js';
import type { TaskFlowVersion } from './task-flows.js';

/**
 * 外呼任务状态机
 *
 * PENDING  ──派发──▶  CALLING  ──接通──▶  IN_CALL  ──结束──▶  COMPLETED
 *    │                   │                    │
 *    │                   │                    └──失败──▶  FAILED
 *    │                   └──无人接听──▶  NO_ANSWER
 *    └──取消──▶  CANCELLED
 */
export enum TaskStatus {
  PENDING = 'pending',
  CALLING = 'calling',
  IN_CALL = 'in_call',
  COMPLETED = 'completed',
  FAILED = 'failed',
  NO_ANSWER = 'no_answer',
  CANCELLED = 'cancelled',
}

export enum TaskPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
}

/** Transport used for a concrete call attempt. */
export type CallAttemptChannel = 'freeswitch' | 'web';

/** 通话结果分类（用于意向分级） */
export enum CallOutcome {
  /** 高意向：客户明确表达意向 */
  HIGH_INTENT = 'high_intent',
  /** 中意向：客户表示可以考虑 */
  MEDIUM_INTENT = 'medium_intent',
  /** 低意向：客户礼貌拒绝 */
  LOW_INTENT = 'low_intent',
  /** 明确拒绝 */
  REJECTED = 'rejected',
  /** 无人接听 */
  UNREACHED = 'unreached',
  /** 转人工 */
  ESCALATED = 'escalated',
  /** 通话异常 */
  ERROR = 'error',
  /** 通话正常完成但未捕获明确意向（中性终态；voice-agent 非转人工默认上报） */
  COMPLETED = 'completed',
}

/** 外呼任务 */
export interface OutboundTask {
  id: string;
  tenantId?: string;
  ownerId?: string;
  /** 被叫号码（E.164，如 +8613800138000）或本机联调 SIP 分机（如 1001） */
  to: string;
  /** 主叫号码 */
  from: string;
  /** 业务场景 */
  scenario: ScenarioKey;
  /** 持久化场景配置 ID。 */
  scenarioId?: string;
  /** API 下发的权威场景配置；Python 本地配置仅用于离线 fallback。 */
  scenarioConfig?: ScenarioConfig;
  /** 场景变量（用于填充话术模板，如 {orderNo}/{product}） */
  variables: Record<string, string>;
  /** 任务优先级。当前随任务上下文保存，后续可迁移为独立调度字段。 */
  priority?: TaskPriority;
  /** 任务状态 */
  status: TaskStatus;
  /** 计划拨打时间（ISO 时间戳） */
  scheduledAt: string;
  /** 实际拨打时间 */
  calledAt?: string;
  /** 通话结束时间 */
  endedAt?: string;
  /** 通话时长（秒） */
  duration?: number;
  /** 通话结果 */
  outcome?: CallOutcome;
  /** 通话转写文本 */
  transcript?: TranscriptTurn[];
  /** 录音 URL */
  recordingUrl?: string;
  /** 意向标签 */
  intentTags?: string[];
  /** 已创建的实际拨打次数。 */
  attemptCount: number;
  /** 详情响应中的拨打尝试记录。 */
  attempts?: CallAttempt[];
  /** 关联的流程配置 ID（可选，指定后 Voice Agent 按流程执行） */
  flowId?: string;
  /** 创建任务时锁定的不可变流程版本。 */
  flowVersionId?: string;
  /** API 详情响应中可内联返回的执行快照。 */
  flowVersion?: TaskFlowVersion;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

export interface CallAttempt {
  id: string;
  taskId: string;
  attemptNo: number;
  channel?: CallAttemptChannel;
  providerCallId?: string;
  providerJobId?: string;
  status: TaskStatus;
  startedAt: string;
  ringingAt?: string;
  answeredAt?: string;
  endedAt?: string;
  duration?: number;
  hangupCause?: string;
  recordingUrl?: string;
  lastProviderEventAt?: string;
  lastProviderSnapshotId?: string;
  lastProviderSnapshotAt?: string;
  missingProviderSnapshotCount?: number;
}

/** 列表页专用轻量模型，不包含流程快照和完整转写。 */
export interface OutboundTaskListItem {
  id: string;
  to: string;
  from: string;
  scenario: ScenarioKey;
  scenarioId?: string;
  priority?: TaskPriority;
  status: TaskStatus;
  scheduledAt: string;
  calledAt?: string;
  endedAt?: string;
  duration?: number;
  outcome?: CallOutcome;
  intentTags?: string[];
  flowId?: string;
  flowVersionId?: string;
  attemptCount: number;
  latestAttemptId?: string;
  transcriptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskListPage {
  items: OutboundTaskListItem[];
  nextCursor?: string;
}

/** 外呼历史列表项：以实际拨打尝试为维度。 */
export interface CallHistoryItem {
  id: string;
  taskId: string;
  attemptNo: number;
  channel?: CallAttemptChannel;
  providerCallId?: string;
  providerJobId?: string;
  to: string;
  from: string;
  scenario: ScenarioKey;
  scenarioId?: string;
  status: TaskStatus;
  startedAt: string;
  ringingAt?: string;
  answeredAt?: string;
  endedAt?: string;
  duration?: number;
  hangupCause?: string;
  recordingUrl?: string;
  lastProviderEventAt?: string;
  lastProviderSnapshotId?: string;
  lastProviderSnapshotAt?: string;
  missingProviderSnapshotCount?: number;
  outcome?: CallOutcome;
  intentTags?: string[];
  transcriptCount: number;
  eventCount: number;
  taskCreatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallHistoryPage {
  items: CallHistoryItem[];
  nextCursor?: string;
}

export interface CallEventRecord {
  id: string;
  type: string;
  provider?: string;
  providerEventId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CallHistoryDetail extends CallHistoryItem {
  scheduledAt: string;
  flowId?: string;
  flowVersionId?: string;
  variables: Record<string, string>;
  transcript: TranscriptTurn[];
  events: CallEventRecord[];
}

/** 对话转写条目 */
export interface TranscriptTurn {
  id?: string;
  /** 谁说的 */
  role: 'agent' | 'caller' | 'system';
  /** 文本内容 */
  content: string;
  /** 时间戳（秒，相对通话开始） */
  timestamp: number;
  /** 该轮的情绪（可选） */
  emotion?: string;
  /** 记录创建时间 */
  createdAt?: string;
}

/** 创建外呼任务请求 */
export interface CreateTaskDto {
  to: string;
  scenario: ScenarioKey;
  /** 指定持久化场景配置时优先使用该配置。 */
  scenarioId?: string;
  variables?: Record<string, string>;
  scheduledAt?: string;
  priority?: TaskPriority;
  /** 关联的流程配置 ID（可选，指定后 Voice Agent 按流程执行） */
  flowId?: string;
}

export interface CreateTaskBatchItem {
  to: string;
  variables?: Record<string, string>;
  scheduledAt?: string;
  priority?: TaskPriority;
}

export interface CreateTaskBatchDto {
  scenario: ScenarioKey;
  /** 指定持久化场景配置时优先使用该配置。 */
  scenarioId?: string;
  variables?: Record<string, string>;
  scheduledAt?: string;
  priority?: TaskPriority;
  /** 关联的流程配置 ID（可选，指定后 Voice Agent 按流程执行） */
  flowId?: string;
  items: CreateTaskBatchItem[];
}

export interface TaskBatchCreateResult {
  createdCount: number;
  tasks: OutboundTaskListItem[];
}

/** 任务查询参数 */
export interface TaskQueryDto {
  scenario?: ScenarioKey;
  status?: TaskStatus;
  outcome?: CallOutcome;
  cursor?: string;
  limit?: number;
}

export interface CallHistoryQueryDto extends TaskQueryDto {}
