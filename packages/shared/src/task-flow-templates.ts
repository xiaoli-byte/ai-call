/**
 * 外呼流程内置模板（前后端共享）
 *
 * 3 个内置模板 + 1 个空白模板。编辑器仅暴露对话、动作、结束三类业务节点，
 * 意图识别直接配置在对话/动作节点的出边上。
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

function edge(
  source: string,
  target: string,
  label?: string,
  intentExamples?: string[],
): FlowEdge {
  return {
    id: `e_${source}_${target}`,
    source,
    target,
    ...(label !== undefined ? { label } : {}),
    ...(intentExamples?.length ? { intentExamples } : {}),
  };
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
  const transfer: FlowNode = {
    id: nid('action', 4),
    type: 'action',
    position: { x: 100, y: 380 },
    data: {
      actionType: 'transfer',
      config: { extension: '9000', reason: '客户要求人工服务' },
    },
  };
  const end: FlowNode = {
    id: nid('end', 5),
    type: 'end',
    position: { x: 420, y: 560 },
    data: {
      mode: 'hangup',
      reason: '催收流程结束',
      farewell: '感谢您的配合，再见。',
    },
  };
  return {
    nodes: [start, greet, transfer, end],
    edges: [
      edge(start.id, greet.id),
      edge(greet.id, transfer.id, '拒绝还款/非本人', ['我不打算还', '这不是我的账单', '你们找错人了']),
      edge(greet.id, end.id),
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
  const afterSale: FlowNode = {
    id: nid('action', 4),
    type: 'action',
    position: { x: 100, y: 380 },
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
    position: { x: 420, y: 560 },
    data: {
      mode: 'complete',
      reason: '电商回访结束',
      farewell: '感谢您的时间，再见。',
    },
  };
  return {
    nodes: [start, greet, afterSale, end],
    edges: [
      edge(start.id, greet.id),
      edge(greet.id, afterSale.id, '不满意/未收到', ['商品有问题', '我还没有收到货', '体验不太好']),
      edge(greet.id, end.id),
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
  const book: FlowNode = {
    id: nid('action', 4),
    type: 'action',
    position: { x: 100, y: 380 },
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
    position: { x: 420, y: 560 },
    data: {
      mode: 'complete',
      reason: '售前咨询结束',
      farewell: '感谢您的咨询，期待为您服务，再见。',
    },
  };
  return {
    nodes: [start, greet, book, end],
    edges: [
      edge(start.id, greet.id),
      edge(greet.id, book.id, '有意向试驾/需要考虑', ['我想预约试驾', '可以去店里看看', '我再考虑一下']),
      edge(greet.id, end.id),
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
    description: '逾期账单催收：问候 → 连线意图分支 → 转人工/结束',
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
    description: '售前咨询：AI 对话 → 连线意图分支 → 试驾预约/结束',
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
