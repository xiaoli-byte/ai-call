import { Scenario, type ScenarioConfig } from './scenarios.js';
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
}

/** 外呼任务 */
export interface OutboundTask {
  id: string;
  /** 被叫号码（E.164 格式，如 +8613800138000） */
  to: string;
  /** 主叫号码 */
  from: string;
  /** 业务场景 */
  scenario: Scenario;
  /** API 下发的权威场景配置；Python 本地配置仅用于离线 fallback。 */
  scenarioConfig?: ScenarioConfig;
  /** 场景变量（用于填充话术模板，如 {orderNo}/{product}） */
  variables: Record<string, string>;
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

/** 对话转写条目 */
export interface TranscriptTurn {
  /** 谁说的 */
  role: 'agent' | 'caller' | 'system';
  /** 文本内容 */
  content: string;
  /** 时间戳（秒，相对通话开始） */
  timestamp: number;
  /** 该轮的情绪（可选） */
  emotion?: string;
}

/** 创建外呼任务请求 */
export interface CreateTaskDto {
  to: string;
  scenario: Scenario;
  variables?: Record<string, string>;
  scheduledAt?: string;
  /** 关联的流程配置 ID（可选，指定后 Voice Agent 按流程执行） */
  flowId?: string;
}

/** 任务查询参数 */
export interface TaskQueryDto {
  scenario?: Scenario;
  status?: TaskStatus;
  outcome?: CallOutcome;
  page?: number;
  pageSize?: number;
}
