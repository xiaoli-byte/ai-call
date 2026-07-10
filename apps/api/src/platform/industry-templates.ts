import type { FlowEdge, FlowNode, IndustryTemplate } from '@ai-call/shared';

export function templateDefaultGreeting(template: IndustryTemplate): string {
  if (template.id === 'ecommerce_after_sale') {
    return '您好，我是售后回访 AI 助手，想确认一下您的订单体验是否顺利。';
  }
  if (template.id === 'appointment_confirm') {
    return '您好，我是预约确认 AI 助手，来和您确认一下预约时间。';
  }
  return '您好，我是智能外呼 AI 助手，今天联系您是为了做一次简短确认。';
}

function node(
  id: string,
  type: FlowNode['type'],
  x: number,
  y: number,
  data: FlowNode['data'],
): FlowNode {
  return { id, type, position: { x, y }, data };
}

function edge(source: string, target: string, label?: string): FlowEdge {
  return { id: `e_${source}_${target}`, source, target, label };
}

function templateFlow(kind: 'collection' | 'ecommerce' | 'appointment' | 'insurance'): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const start = node('start_1', 'start', 260, 20, {});
  const greetText = {
    collection: '您好，我是智能还款提醒助手，想和您确认本期账单的处理安排。',
    ecommerce: '您好，我是{{shop}}的售后回访助手，想了解您收到{{product}}后的使用体验。',
    appointment: '您好，我是预约确认助手，来和您确认{{appointmentTime}}的到店安排。',
    insurance: '您好，我是保单服务助手，提醒您{{policyName}}即将到期，想确认续保意向。',
  }[kind];
  const greet = node('dialog_2', 'dialog', 260, 200, {
    mode: 'script',
    text: greetText,
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 12,
  });
  const decision = node('decision_3', 'decision', 260, 380, {
    mode: 'intent',
    intents: kind === 'collection'
      ? ['同意处理', '需要延期', '明确拒绝', '转人工']
      : ['满意/确认', '有疑问', '需要人工', '明确拒绝'],
  });
  const action = node('action_4', 'action', 100, 560, {
    actionType: kind === 'appointment' ? 'sms' : 'crm',
    config: kind === 'appointment'
      ? { template: 'appointment_confirm', params: { time: '{{appointmentTime}}' } }
      : { action: `${kind}_follow_up`, priority: 'normal' },
  });
  const handoff = node('action_5', 'action', 420, 560, {
    actionType: 'transfer',
    config: { extension: '9000', reason: '用户需要人工协助或存在高风险意图' },
  });
  const end = node('end_6', 'end', 260, 740, {
    mode: 'complete',
    reason: '模板流程结束',
    farewell: '感谢您的时间，祝您生活愉快，再见。',
  });
  return {
    nodes: [start, greet, decision, action, handoff, end],
    edges: [
      edge(start.id, greet.id),
      edge(greet.id, decision.id),
      edge(decision.id, action.id, '确认/可继续'),
      edge(decision.id, handoff.id, '有疑问/转人工/高风险'),
      edge(action.id, end.id),
      edge(handoff.id, end.id),
    ],
  };
}

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    id: 'collection_reminder',
    name: '贷后催收提醒',
    industry: '金融',
    scenarioKey: 'collection_reminder',
    description: '面向逾期账单的合规提醒、还款意向识别和转人工协商。',
    complexity: 'high',
    recommendedProviders: ['FunASR', 'DeepSeek/Qwen', 'Qwen-TTS/CosyVoice', 'FreeSWITCH'],
    complianceNotes: ['必须披露 AI 身份', '不得使用威胁性话术', '客户拒绝后停止营销式追问'],
    successMetrics: ['接通率', '承诺还款率', '转人工协商率', '投诉风险率'],
    knowledgeSchema: ['产品合同摘要', '逾期政策', '分期/延期规则', '禁止话术清单'],
    qualityRules: ['未披露 AI 身份', '敏感承诺', '客户明确拒绝仍继续营销'],
    ...templateFlow('collection'),
  },
  {
    id: 'ecommerce_after_sale',
    name: '电商售后回访',
    industry: '电商',
    scenarioKey: 'ecommerce_after_sale',
    description: '确认收货、满意度回访、售后工单创建和物流异常处理。',
    complexity: 'medium',
    recommendedProviders: ['FunASR', 'DeepSeek/Qwen', 'Mock/CosyVoice'],
    complianceNotes: ['开场说明回访目的', '不收集无关隐私', '投诉或质量问题转人工'],
    successMetrics: ['有效沟通率', '满意反馈率', '售后工单创建率', '问题闭环率'],
    knowledgeSchema: ['退换货规则', '物流查询字段', '售后分类', '补偿政策'],
    qualityRules: ['未确认用户问题', '售后承诺超出政策', '未创建必要工单'],
    ...templateFlow('ecommerce'),
  },
  {
    id: 'appointment_confirm',
    name: '预约确认',
    industry: '本地服务',
    scenarioKey: 'appointment_confirm',
    description: '用于试驾、到店、课程、体检等预约前确认和改期。',
    complexity: 'low',
    recommendedProviders: ['FunASR', 'DeepSeek/Qwen', 'Mock TTS'],
    complianceNotes: ['确认身份后再播报预约细节', '仅发送用户已同意的提醒短信'],
    successMetrics: ['预约确认率', '改期率', '短信触达率', '爽约下降率'],
    knowledgeSchema: ['门店地址', '预约规则', '改期政策', '准备材料'],
    qualityRules: ['身份未确认即透露隐私', '未处理改期需求', '短信变量缺失'],
    ...templateFlow('appointment'),
  },
  {
    id: 'insurance_renewal',
    name: '保险续保提醒',
    industry: '保险',
    scenarioKey: 'insurance_renewal',
    description: '保单到期提醒、续保意向识别、保障差异说明和坐席承接。',
    complexity: 'high',
    recommendedProviders: ['FunASR', 'DeepSeek/Qwen', 'Qwen-TTS'],
    complianceNotes: ['不得承诺收益', '复杂保障解释转人工', '保留客户授权记录'],
    successMetrics: ['续保意向率', '人工承接率', '异议原因分布', '合规风险率'],
    knowledgeSchema: ['保单摘要', '续保报价', '保障差异', '常见异议'],
    qualityRules: ['收益承诺', '保障范围误导', '未记录退订/拒绝'],
    ...templateFlow('insurance'),
  },
];
