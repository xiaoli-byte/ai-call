/**
 * 外呼任务流程配置共享类型。
 *
 * 采用现代 TypeScript 实践（string literal union types + discriminated unions），
 * 强类型可推断。节点系统遵循"极简 5 节点"原则：能力通过配置表达，而非增加节点数量。
 *
 * 节点类型：
 * - start：唯一入口节点，整个流程只能有一个
 * - dialog：统一所有对话能力（固定话术/提问/AI 回复）
 * - decision：统一所有分支判断（条件/意图）
 * - action：统一业务动作（转人工/发短信/CRM/API）
 * - end：统一结束行为（正常结束/挂机）
 */

// ============================================================
// 节点类型（5 种极简节点系统）
// ============================================================

export type FlowNodeType = 'start' | 'dialog' | 'decision' | 'action' | 'end';

export const FlowStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;
export type FlowStatus = (typeof FlowStatus)[keyof typeof FlowStatus];

// --- Start Node（唯一入口，整个流程只能有一个）---
export interface StartNodeData {
  // 无字段，仅占位
}

// --- Dialog Node（统一所有对话能力：固定话术/提问/AI 回复）---
export type DialogMode = 'script' | 'question' | 'ai';

export interface DialogNodeData {
  mode: DialogMode;
  /** script 模式：固定话术文本 */
  text?: string;
  /** question/ai 模式：提示语 */
  prompt?: string;
  /** AI 模式：系统提示词 */
  systemPrompt?: string;
  /** AI 模式：温度参数 */
  temperature?: number;
  /** 是否可被打断（用户说话时停止 TTS）*/
  interruptible: boolean;
  /** 是否等待用户响应 */
  waitForResponse: boolean;
  /** 等待超时（秒）*/
  timeoutSeconds?: number;
  /** 重试次数（question 模式）*/
  retryCount?: number;
}

// --- Decision Node（统一所有分支判断：条件/意图）---
export type DecisionMode = 'condition' | 'intent';

export interface DecisionNodeData {
  mode: DecisionMode;
  /** condition 模式：表达式（如 "response.includes('满意')"）*/
  expression?: string;
  /** intent 模式：意图列表（如 ["感兴趣", "拒绝", "忙", "稍后联系"]）*/
  intents?: string[];
}

// --- Action Node（统一业务动作：转人工/发短信/CRM/API）---
export type ActionType = 'transfer' | 'sms' | 'crm' | 'api';

export interface ActionNodeData {
  actionType: ActionType;
  /** 动作配置（按 actionType 不同结构不同）*/
  config: Record<string, unknown>;
}

// --- End Node（统一结束行为：正常结束/挂机）---
export type EndMode = 'complete' | 'hangup';

export interface EndNodeData {
  mode: EndMode;
  /** 结束原因（可选）*/
  reason?: string;
  /** 告别话术（可选，TTS 播报后挂机）*/
  farewell?: string;
}

// --- 节点 data 的 discriminated union ---
export type FlowNodeData =
  | StartNodeData
  | DialogNodeData
  | DecisionNodeData
  | ActionNodeData
  | EndNodeData;

// ============================================================
// Flow 数据结构
// ============================================================

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** 分支条件标签（Decision 节点出口边的 label 兼作分支条件）*/
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface TaskFlow extends FlowDefinition {
  id: string;
  name: string;
  description: string;
  status: FlowStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 发布后不可变的流程快照；运行中的任务只引用该模型。 */
export interface TaskFlowVersion extends FlowDefinition {
  id: string;
  flowId: string;
  version: number;
  name: string;
  description: string;
  createdAt: string;
}

export interface FlowValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface CreateTaskFlowDto {
  name: string;
  description?: string;
  templateId?: string;
  nodes?: FlowNode[];
  edges?: FlowEdge[];
}

export interface UpdateTaskFlowDto {
  name?: string;
  description?: string;
  nodes?: FlowNode[];
  edges?: FlowEdge[];
}
