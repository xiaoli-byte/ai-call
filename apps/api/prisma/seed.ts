/* eslint-disable no-console */
/**
 * Seed 脚本 - 创建示例外呼任务流程
 *
 * 用法：
 *   pnpm prisma:seed
 *
 * 创建 3 个示例流程：催收 / 电商回访 / 售前咨询
 * 每个流程包含 Start → Dialog → Decision → Action → End 完整节点链。
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { FlowEdge, FlowNode } from '@ai-call/shared';

config({ path: resolve(process.cwd(), '..', '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ============================================================
// 辅助函数
// ============================================================

let nodeCounter = 0;
function nid(prefix: string): string {
  nodeCounter += 1;
  return `${prefix}_${nodeCounter}`;
}

function startNode(x: number, y: number): FlowNode {
  return {
    id: nid('start'),
    type: 'start',
    position: { x, y },
    data: {},
  };
}

function dialogNode(
  x: number,
  y: number,
  data: Record<string, unknown>,
): FlowNode {
  return {
    id: nid('dialog'),
    type: 'dialog',
    position: { x, y },
    data: data as never,
  };
}

function decisionNode(
  x: number,
  y: number,
  data: Record<string, unknown>,
): FlowNode {
  return {
    id: nid('decision'),
    type: 'decision',
    position: { x, y },
    data: data as never,
  };
}

function actionNode(
  x: number,
  y: number,
  data: Record<string, unknown>,
): FlowNode {
  return {
    id: nid('action'),
    type: 'action',
    position: { x, y },
    data: data as never,
  };
}

function endNode(
  x: number,
  y: number,
  data: Record<string, unknown>,
): FlowNode {
  return {
    id: nid('end'),
    type: 'end',
    position: { x, y },
    data: data as never,
  };
}

function edge(source: string, target: string, label?: string): FlowEdge {
  return {
    id: `e_${source}_${target}`,
    source,
    target,
    label,
  };
}

// ============================================================
// 示例流程 1：催收流程
// ============================================================

function buildCollectionFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  nodeCounter = 0;
  const start = startNode(100, 200);
  const greet = dialogNode(320, 200, {
    mode: 'script',
    text: '您好，我是智能客服助手，关于您尾号 {last4} 的账单，目前已逾期 {days} 天，欠款金额 {amount} 元，请问您近期方便安排还款吗？',
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 10,
  });
  const decide = decisionNode(540, 200, {
    mode: 'intent',
    intents: ['同意还款', '拒绝还款', '经济困难', '非本人'],
  });
  const remind = dialogNode(760, 100, {
    mode: 'script',
    text: '好的，已为您记录还款意愿。请于 3 个工作日内完成还款，否则将影响您的信用记录。',
    interruptible: false,
    waitForResponse: false,
  });
  const negotiate = dialogNode(760, 200, {
    mode: 'ai',
    prompt: '了解客户困难，协商分期或延期方案',
    systemPrompt: '你是催收协商专员，态度专业但有原则，最多同意分 3 期。',
    temperature: 0.3,
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 120,
  });
  const transfer = actionNode(760, 300, {
    actionType: 'transfer',
    config: { extension: '9000', reason: '客户要求人工服务' },
  });
  const end = endNode(980, 200, {
    mode: 'complete',
    reason: '催收流程结束',
    farewell: '感谢您的配合，再见。',
  });

  const nodes = [start, greet, decide, remind, negotiate, transfer, end];
  const edges = [
    edge(start.id, greet.id),
    edge(greet.id, decide.id),
    edge(decide.id, remind.id, '同意还款'),
    edge(decide.id, negotiate.id, '经济困难'),
    edge(decide.id, transfer.id, '拒绝还款/非本人'),
    edge(remind.id, end.id),
    edge(negotiate.id, end.id),
    edge(transfer.id, end.id),
  ];
  return { nodes, edges };
}

// ============================================================
// 示例流程 2：电商回访流程
// ============================================================

function buildEcommerceFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  nodeCounter = 0;
  const start = startNode(100, 200);
  const greet = dialogNode(320, 200, {
    mode: 'script',
    text: '您好，我是{shop}的客服，您在{date}购买的{product}收到了吗？想了解一下您的使用体验。',
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 10,
  });
  const decide = decisionNode(540, 200, {
    mode: 'intent',
    intents: ['满意', '不满意', '未收到'],
  });
  const thanks = dialogNode(760, 100, {
    mode: 'script',
    text: '非常感谢您的反馈！期待您再次光临，祝您生活愉快。',
    interruptible: false,
    waitForResponse: false,
  });
  const afterSale = actionNode(760, 200, {
    actionType: 'crm',
    config: {
      action: 'create_after_sale_ticket',
      reason: '客户不满意',
      priority: 'high',
    },
  });
  const logistics = actionNode(760, 300, {
    actionType: 'api',
    config: {
      action: 'query_logistics',
      orderNo: '{orderNo}',
    },
  });
  const end = endNode(980, 200, {
    mode: 'complete',
    reason: '电商回访结束',
    farewell: '感谢您的时间，再见。',
  });

  const nodes = [start, greet, decide, thanks, afterSale, logistics, end];
  const edges = [
    edge(start.id, greet.id),
    edge(greet.id, decide.id),
    edge(decide.id, thanks.id, '满意'),
    edge(decide.id, afterSale.id, '不满意'),
    edge(decide.id, logistics.id, '未收到'),
    edge(thanks.id, end.id),
    edge(afterSale.id, end.id),
    edge(logistics.id, end.id),
  ];
  return { nodes, edges };
}

// ============================================================
// 示例流程 3：售前咨询流程
// ============================================================

function buildPresaleFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  nodeCounter = 0;
  const start = startNode(100, 200);
  const greet = dialogNode(320, 200, {
    mode: 'ai',
    prompt: '了解客户对{product}的咨询需求',
    systemPrompt:
      '你是汽车 4S 店售前顾问，专业且热情，主动介绍车型亮点并邀约到店试驾。',
    temperature: 0.7,
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 180,
  });
  const decide = decisionNode(540, 200, {
    mode: 'intent',
    intents: ['有意向试驾', '需要考虑', '无意向'],
  });
  const book = actionNode(760, 100, {
    actionType: 'crm',
    config: {
      action: 'create_test_drive_appointment',
      model: '{product}',
    },
  });
  const followUp = dialogNode(760, 200, {
    mode: 'script',
    text: '好的，我先加您微信，稍后发送详细资料给您，有任何问题随时联系。',
    interruptible: false,
    waitForResponse: false,
  });
  const sms = actionNode(760, 300, {
    actionType: 'sms',
    config: {
      template: 'presale_followup',
      product: '{product}',
    },
  });
  const end = endNode(980, 200, {
    mode: 'complete',
    reason: '售前咨询结束',
    farewell: '感谢您的咨询，期待为您服务，再见。',
  });

  const nodes = [start, greet, decide, book, followUp, sms, end];
  const edges = [
    edge(start.id, greet.id),
    edge(greet.id, decide.id),
    edge(decide.id, book.id, '有意向试驾'),
    edge(decide.id, followUp.id, '需要考虑'),
    edge(decide.id, sms.id, '无意向'),
    edge(book.id, end.id),
    edge(followUp.id, end.id),
    edge(sms.id, end.id),
  ];
  return { nodes, edges };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log('🌱 Seeding task flows...');

  const seeds = [
    {
      name: '催收标准流程',
      description: '逾期账单催收：问候 → 意图识别 → 分支（同意/协商/转人工）',
      builder: buildCollectionFlow,
    },
    {
      name: '电商回访流程',
      description: '订单回访：确认收货 → 满意度调查 → 分支（满意/售后/物流）',
      builder: buildEcommerceFlow,
    },
    {
      name: '汽车售前咨询流程',
      description: '售前咨询：AI 对话 → 意向判断 → 分支（试驾/跟进/短信）',
      builder: buildPresaleFlow,
    },
  ];

  for (const seed of seeds) {
    const { nodes, edges } = seed.builder();
    const existing = await prisma.taskFlow.findFirst({
      where: { name: seed.name },
    });
    if (existing) {
      console.log(`  ⏭️  [跳过] "${seed.name}" 已存在 (id=${existing.id})`);
      continue;
    }
    const record = await prisma.taskFlow.create({
      data: {
        name: seed.name,
        description: seed.description,
        status: 'draft',
        nodes: nodes as never,
        edges: edges as never,
      },
    });
    console.log(
      `  ✅ [创建] "${seed.name}" id=${record.id} (${nodes.length} 节点, ${edges.length} 边)`,
    );
  }

  console.log('🌱 Seed completed.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
