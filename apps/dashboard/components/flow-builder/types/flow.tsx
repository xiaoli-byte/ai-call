/**
 * Flow Builder 本地类型定义
 *
 * 从 @ai-call/shared 重新导出节点类型，并补充组件专用元数据。
 */
import type {
  FlowEdge,
  FlowNode,
  FlowNodeData,
  FlowNodeType,
  DialogNodeData,
  DecisionNodeData,
  ActionNodeData,
  EndNodeData,
  DialogMode,
  DecisionMode,
  ActionType,
  EndMode,
} from '@ai-call/shared';

export type {
  FlowEdge,
  FlowNode,
  FlowNodeData,
  FlowNodeType,
  DialogNodeData,
  DecisionNodeData,
  ActionNodeData,
  EndNodeData,
  DialogMode,
  DecisionMode,
  ActionType,
  EndMode,
};

/** 节点元数据（用于 UI 渲染）*/
export interface NodeMeta {
  type: FlowNodeType;
  icon: (props: { className?: string }) => JSX.Element;
  title: string;
  description: string;
  /** 顶边颜色（Tailwind 颜色 token） */
  accent: 'primary' | 'success' | 'warning' | 'violet' | 'danger';
}

const StartIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
  </svg>
);

const DialogIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const DecisionIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6v0" />
    <path d="M3 3h6M3 9h6M15 21h6M15 15h6" />
  </svg>
);

const ActionIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const EndIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
);

export const NODE_META: Record<FlowNodeType, NodeMeta> = {
  start: {
    type: 'start',
    icon: StartIcon,
    title: '开始',
    description: '流程开始',
    accent: 'primary',
  },
  dialog: {
    type: 'dialog',
    icon: DialogIcon,
    title: '对话',
    description: '固定话术/提问/AI',
    accent: 'success',
  },
  decision: {
    type: 'decision',
    icon: DecisionIcon,
    title: '判断',
    description: '条件/意图分支',
    accent: 'warning',
  },
  action: {
    type: 'action',
    icon: ActionIcon,
    title: '动作',
    description: '转人工/短信/CRM/API',
    accent: 'violet',
  },
  end: {
    type: 'end',
    icon: EndIcon,
    title: '结束',
    description: '正常结束/挂机',
    accent: 'danger',
  },
};

/** 智能推荐规则：上游节点类型 → 推荐的下游节点类型 */
export const RECOMMENDATIONS: Record<FlowNodeType, FlowNodeType[]> = {
  start: ['dialog'],
  dialog: ['dialog', 'decision', 'action', 'end'],
  decision: ['dialog', 'action', 'end'],
  action: ['dialog', 'end'],
  end: [],
};

/** AddMenu 可选的节点类型（不含 start，整个流程只能有一个）*/
export const ADDABLE_NODE_TYPES: FlowNodeType[] = [
  'dialog',
  'decision',
  'action',
  'end',
];

/** 获取节点默认 data */
export function getDefaultNodeData(type: FlowNodeType): FlowNodeData {
  switch (type) {
    case 'start':
      return {};
    case 'dialog':
      return {
        mode: 'script',
        interruptible: true,
        waitForResponse: false,
      };
    case 'decision':
      return { mode: 'intent', intents: [] };
    case 'action':
      return { actionType: 'transfer', config: {} };
    case 'end':
      return { mode: 'complete' };
  }
}