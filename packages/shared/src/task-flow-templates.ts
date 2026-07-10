/**
 * 外呼流程内置模板（前后端共享）
 *
 * 3 个内置模板 + 1 个空白模板。每个模板使用新 5 节点系统，
 * 预设 start → dialog → decision → action → end 链。
 */
import type { FlowEdge, FlowNode } from './task-flows.js';

export interface TaskFlowTemplate {
  id: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

function nid(prefix: string, i: number): string {
  return `${prefix}_${i}`;
}

function edge(source: string, target: string, label?: string): FlowEdge {
  return { id: `e_${source}_${target}`, source, target, label };
}

/** 空白模板：仅 1 个 Start 节点 */
function blankTemplate(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const start: FlowNode = {
    id: nid('start', 1),
    type: 'start',
    position: { x: 260, y: 20 },
    data: {},
  };
  return { nodes: [start], edges: [] };
}

/** 催收模板：问候 → 意图识别 → 转人工/结束 */
function collectionTemplate(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const start: FlowNode = {
    id: nid('start', 1),
    type: 'start',
    position: { x: 260, y: 20 },
    data: {},
  };
  const greet: FlowNode = {
    id: nid('dialog', 2),
    type: 'dialog',
    position: { x: 260, y: 200 },
    data: {
      mode: 'script',
      text: '您好，我是智能客服助手，关于您尾号 {last4} 的账单，目前已逾期 {days} 天，欠款金额 {amount} 元，请问您近期方便安排还款吗？',
      interruptible: true,
      waitForResponse: true,
      timeoutSeconds: 10,
    },
  };
  const decide: FlowNode = {
    id: nid('decision', 3),
    type: 'decision',
    position: { x: 260, y: 380 },
    data: {
      mode: 'intent',
      intents: ['同意还款', '拒绝还款', '经济困难', '非本人'],
    },
  };
  const transfer: FlowNode = {
    id: nid('action', 4),
    type: 'action',
    position: { x: 260, y: 560 },
    data: {
      actionType: 'transfer',
      config: { extension: '9000', reason: '客户要求人工服务' },
    },
  };
  const end: FlowNode = {
    id: nid('end', 5),
    type: 'end',
    position: { x: 260, y: 740 },
    data: {
      mode: 'hangup',
      reason: '催收流程结束',
      farewell: '感谢您的配合，再见。',
    },
  };
  return {
    nodes: [start, greet, decide, transfer, end],
    edges: [
      edge(start.id, greet.id),
      edge(greet.id, decide.id),
      edge(decide.id, transfer.id, '拒绝还款/非本人'),
      edge(decide.id, end.id, '同意还款/经济困难'),
      edge(transfer.id, end.id),
    ],
  };
}

/** 电商售后模板：确认收货 → 满意度 → 售后/结束 */
function ecommerceTemplate(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const start: FlowNode = {
    id: nid('start', 1),
    type: 'start',
    position: { x: 260, y: 20 },
    data: {},
  };
  const greet: FlowNode = {
    id: nid('dialog', 2),
    type: 'dialog',
    position: { x: 260, y: 200 },
    data: {
      mode: 'script',
      text: '您好，我是{shop}的客服，您在{date}购买的{product}收到了吗？想了解一下您的使用体验。',
      interruptible: true,
      waitForResponse: true,
      timeoutSeconds: 10,
    },
  };
  const decide: FlowNode = {
    id: nid('decision', 3),
    type: 'decision',
    position: { x: 260, y: 380 },
    data: {
      mode: 'intent',
      intents: ['满意', '不满意', '未收到'],
    },
  };
  const afterSale: FlowNode = {
    id: nid('action', 4),
    type: 'action',
    position: { x: 260, y: 560 },
    data: {
      actionType: 'crm',
      config: {
        action: 'create_after_sale_ticket',
        reason: '客户不满意',
        priority: 'high',
      },
    },
  };
  const end: FlowNode = {
    id: nid('end', 5),
    type: 'end',
    position: { x: 260, y: 740 },
    data: {
      mode: 'complete',
      reason: '电商回访结束',
      farewell: '感谢您的时间，再见。',
    },
  };
  return {
    nodes: [start, greet, decide, afterSale, end],
    edges: [
      edge(start.id, greet.id),
      edge(greet.id, decide.id),
      edge(decide.id, afterSale.id, '不满意/未收到'),
      edge(decide.id, end.id, '满意'),
      edge(afterSale.id, end.id),
    ],
  };
}

/** 售前咨询模板：AI 对话 → 意向判断 → 试驾/跟进 */
function presaleTemplate(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const start: FlowNode = {
    id: nid('start', 1),
    type: 'start',
    position: { x: 260, y: 20 },
    data: {},
  };
  const greet: FlowNode = {
    id: nid('dialog', 2),
    type: 'dialog',
    position: { x: 260, y: 200 },
    data: {
      mode: 'ai',
      prompt: '了解客户对{product}的咨询需求',
      systemPrompt:
        '你是汽车 4S 店售前顾问，专业且热情，主动介绍车型亮点并邀约到店试驾。',
      temperature: 0.7,
      interruptible: true,
      waitForResponse: true,
      timeoutSeconds: 180,
    },
  };
  const decide: FlowNode = {
    id: nid('decision', 3),
    type: 'decision',
    position: { x: 260, y: 380 },
    data: {
      mode: 'intent',
      intents: ['有意向试驾', '需要考虑', '无意向'],
    },
  };
  const book: FlowNode = {
    id: nid('action', 4),
    type: 'action',
    position: { x: 260, y: 560 },
    data: {
      actionType: 'crm',
      config: {
        action: 'create_test_drive_appointment',
        model: '{product}',
      },
    },
  };
  const end: FlowNode = {
    id: nid('end', 5),
    type: 'end',
    position: { x: 260, y: 740 },
    data: {
      mode: 'complete',
      reason: '售前咨询结束',
      farewell: '感谢您的咨询，期待为您服务，再见。',
    },
  };
  return {
    nodes: [start, greet, decide, book, end],
    edges: [
      edge(start.id, greet.id),
      edge(greet.id, decide.id),
      edge(decide.id, book.id, '有意向试驾/需要考虑'),
      edge(decide.id, end.id, '无意向'),
      edge(book.id, end.id),
    ],
  };
}

/** 所有内置模板（新建页使用） */
export const TASK_FLOW_TEMPLATES: TaskFlowTemplate[] = [
  {
    id: 'blank',
    name: '空白流程',
    description: '从零开始，仅包含一个 Start 节点',
    ...blankTemplate(),
  },
  {
    id: 'collection',
    name: '贷后催收模板',
    description: '逾期账单催收：问候 → 意图识别 → 转人工/结束',
    ...collectionTemplate(),
  },
  {
    id: 'ecommerce',
    name: '电商回访模板',
    description: '订单回访：确认收货 → 满意度调查 → 售后/结束',
    ...ecommerceTemplate(),
  },
  {
    id: 'presale',
    name: '售前咨询模板',
    description: '售前咨询：AI 对话 → 意向判断 → 试驾预约/结束',
    ...presaleTemplate(),
  },
];

/** 根据 templateId 获取模板内容，未找到返回空白模板 */
export function getTemplate(
  templateId: string,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const t = TASK_FLOW_TEMPLATES.find((x) => x.id === templateId);
  if (t) return { nodes: t.nodes, edges: t.edges };
  return blankTemplate();
}
