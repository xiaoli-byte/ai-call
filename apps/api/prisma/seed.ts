/* eslint-disable no-console */
/**
 * Seed 脚本 - 创建示例外呼任务流程、默认权限/角色/管理员
 *
 * 用法：
 *   pnpm prisma:seed
 *
 * 创建 3 个示例流程：催收 / 电商回访 / 售前咨询
 * 每个流程包含 Start → Dialog → Decision → Action → End 完整节点链。
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { hash } from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  DEFAULT_API_PLUGINS,
  DEFAULT_GLOBAL_VARIABLES,
  DEFAULT_OUTBOUND_RULES,
  PERMISSIONS,
  ROLE_TEMPLATES,
  SCENARIO_CONFIGS,
  Scenario,
} from '@ai-call/shared';
import type {
  FlowEdge,
  FlowNode,
  PermissionCode,
} from '@ai-call/shared';

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
  const start = startNode(260, 20);
  const greet = dialogNode(260, 200, {
    mode: 'script',
    text: '您好，我是智能客服助手，关于您尾号 {last4} 的账单，目前已逾期 {days} 天，欠款金额 {amount} 元，请问您近期方便安排还款吗？',
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 10,
  });
  const decide = decisionNode(260, 380, {
    mode: 'intent',
    intents: ['同意还款', '拒绝还款', '经济困难', '非本人'],
  });
  const remind = dialogNode(-60, 560, {
    mode: 'script',
    text: '好的，已为您记录还款意愿。请于 3 个工作日内完成还款，否则将影响您的信用记录。',
    interruptible: false,
    waitForResponse: false,
  });
  const negotiate = dialogNode(260, 560, {
    mode: 'ai',
    prompt: '了解客户困难，协商分期或延期方案',
    systemPrompt: '你是催收协商专员，态度专业但有原则，最多同意分 3 期。',
    temperature: 0.3,
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 120,
  });
  const transfer = actionNode(580, 560, {
    actionType: 'transfer',
    config: { extension: '9000', reason: '客户要求人工服务' },
  });
  const end = endNode(260, 740, {
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
  const start = startNode(260, 20);
  const greet = dialogNode(260, 200, {
    mode: 'script',
    text: '您好，我是{shop}的客服，您在{date}购买的{product}收到了吗？想了解一下您的使用体验。',
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 10,
  });
  const decide = decisionNode(260, 380, {
    mode: 'intent',
    intents: ['满意', '不满意', '未收到'],
  });
  const thanks = dialogNode(-60, 560, {
    mode: 'script',
    text: '非常感谢您的反馈！期待您再次光临，祝您生活愉快。',
    interruptible: false,
    waitForResponse: false,
  });
  const afterSale = actionNode(260, 560, {
    actionType: 'crm',
    config: {
      action: 'create_after_sale_ticket',
      reason: '客户不满意',
      priority: 'high',
    },
  });
  const logistics = actionNode(580, 560, {
    actionType: 'api',
    config: {
      action: 'query_logistics',
      orderNo: '{orderNo}',
    },
  });
  const end = endNode(260, 740, {
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
  const start = startNode(260, 20);
  const greet = dialogNode(260, 200, {
    mode: 'ai',
    prompt: '了解客户对{product}的咨询需求',
    systemPrompt:
      '你是汽车 4S 店售前顾问，专业且热情，主动介绍车型亮点并邀约到店试驾。',
    temperature: 0.7,
    interruptible: true,
    waitForResponse: true,
    timeoutSeconds: 180,
  });
  const decide = decisionNode(260, 380, {
    mode: 'intent',
    intents: ['有意向试驾', '需要考虑', '无意向'],
  });
  const book = actionNode(-60, 560, {
    actionType: 'crm',
    config: {
      action: 'create_test_drive_appointment',
      model: '{product}',
    },
  });
  const followUp = dialogNode(260, 560, {
    mode: 'script',
    text: '好的，我先加您微信，稍后发送详细资料给您，有任何问题随时联系。',
    interruptible: false,
    waitForResponse: false,
  });
  const sms = actionNode(580, 560, {
    actionType: 'sms',
    config: {
      template: 'presale_followup',
      product: '{product}',
    },
  });
  const end = endNode(260, 740, {
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
// 权限 / 角色 / 默认管理员
// ============================================================

async function seedAuth(): Promise<void> {
  // CALL-02：共享默认租户（与 ai-knowledge BOOTSTRAP_TENANT_ID 对齐为 tenant_demo）。
  // 业务表 tenant_id 默认值与迁移回填均指向它；先建，保证外键/引用一致。
  console.log('🌱 Seeding default tenant...');
  await prisma.tenant.upsert({
    where: { id: 'tenant_demo' },
    update: {},
    create: { id: 'tenant_demo', slug: 'demo', name: 'Demo 租户', status: 'active' },
  });
  console.log('  ✅ tenant tenant_demo');

  console.log('🌱 Seeding permissions & roles...');

  const permissionMap = new Map<PermissionCode, string>();
  for (const code of Object.values(PERMISSIONS)) {
    const existing = await prisma.permission.findUnique({ where: { code } });
    if (existing) {
      permissionMap.set(code, existing.id);
      continue;
    }
    const created = await prisma.permission.create({
      data: { code, description: code },
    });
    permissionMap.set(code, created.id);
    console.log(`  ✅ [创建] permission ${code}`);
  }

  const roleNames = Object.keys(ROLE_TEMPLATES) as Array<
    keyof typeof ROLE_TEMPLATES
  >;
  for (const key of roleNames) {
    const template = ROLE_TEMPLATES[key];
    let role = await prisma.role.findUnique({ where: { name: template.name } });
    if (!role) {
      role = await prisma.role.create({
        data: {
          name: template.name,
          description: template.description,
        },
      });
      console.log(`  ✅ [创建] role ${role.name}`);
    }

    const existingPermissionIds = new Set(
      (
        await prisma.rolePermission.findMany({
          where: { roleId: role.id },
          select: { permissionId: true },
        })
      ).map((rp) => rp.permissionId),
    );

    const permissionIds = template.permissions.map((code) => permissionMap.get(code)!);
    for (const permissionId of permissionIds) {
      if (existingPermissionIds.has(permissionId)) continue;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId },
      });
    }
  }

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: ROLE_TEMPLATES.admin.name },
  });

  const adminEmail =
    process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@ai-call.local';
  const adminPassword =
    process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123';

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });
  if (!existingAdmin) {
    const passwordHash = await hash(adminPassword, 10);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: '系统管理员',
        status: 'active',
        roles: {
          create: { roleId: adminRole.id },
        },
      },
    });
    console.log(`  ✅ [创建] admin user ${adminEmail}`);
  } else {
    console.log(`  ⏭️  [跳过] admin user ${adminEmail} 已存在`);
  }
}

// ============================================================
// 场景配置
// ============================================================

async function seedScenarios(): Promise<Map<string, string>> {
  console.log('🌱 Seeding outbound scenarios...');
  const ids = new Map<string, string>();
  for (const config of Object.values(SCENARIO_CONFIGS)) {
    const record = await prisma.outboundScenario.upsert({
      where: { scenario: config.scenario },
      update: {
        name: config.name,
        description: config.description,
        status: config.status ?? 'active',
        ttsConfig: config.ttsConfig as never,
        agentIdentity: config.agentIdentity ?? '',
        communicationStyle: config.communicationStyle ?? '',
        communicationStylePrompt: config.communicationStylePrompt ?? '',
        businessGoal: config.businessGoal ?? '',
        llmConstraints: (config.llmConstraints ?? []) as never,
        systemPrompt: config.systemPrompt,
        greeting: config.greeting,
        knowledgeBaseId: config.knowledgeBaseId,
        allowedTools: config.allowedTools as never,
        escalationRules: config.escalationRules as never,
      },
      create: {
        scenario: config.scenario,
        name: config.name,
        description: config.description,
        status: config.status ?? 'active',
        ttsConfig: config.ttsConfig as never,
        agentIdentity: config.agentIdentity ?? '',
        communicationStyle: config.communicationStyle ?? '',
        communicationStylePrompt: config.communicationStylePrompt ?? '',
        businessGoal: config.businessGoal ?? '',
        llmConstraints: (config.llmConstraints ?? []) as never,
        systemPrompt: config.systemPrompt,
        greeting: config.greeting,
        knowledgeBaseId: config.knowledgeBaseId,
        allowedTools: config.allowedTools as never,
        escalationRules: config.escalationRules as never,
      },
    });
    ids.set(config.scenario, record.id);
    console.log(`  ✅ [同步] scenario ${config.scenario} (${record.name})`);
  }
  return ids;
}

async function seedGlobalConfig(): Promise<void> {
  console.log('🌱 Seeding global config...');
  await prisma.globalConfig.upsert({
    where: { id: 'default' },
    update: {
      globalVariables: DEFAULT_GLOBAL_VARIABLES as never,
      apiPlugins: DEFAULT_API_PLUGINS as never,
      outboundRules: DEFAULT_OUTBOUND_RULES as never,
    },
    create: {
      id: 'default',
      globalVariables: DEFAULT_GLOBAL_VARIABLES as never,
      apiPlugins: DEFAULT_API_PLUGINS as never,
      outboundRules: DEFAULT_OUTBOUND_RULES as never,
    },
  });
  console.log('  ✅ [同步] global config');
}

async function ensurePublishedFlowVersion(
  flowId: string,
  scenario: Scenario,
) {
  const existingVersion = await prisma.taskFlowVersion.findFirst({
    where: { flowId },
    orderBy: { version: 'desc' },
  });
  if (existingVersion) {
    console.log(`  ⏭️  [跳过] flow=${flowId} 已有发布版本 v${existingVersion.version}`);
    return existingVersion;
  }

  const flow = await prisma.taskFlow.update({
    where: { id: flowId },
    data: { status: 'published', version: { increment: 1 } },
  });
  const version = await prisma.taskFlowVersion.create({
    data: {
      flowId,
      version: flow.version,
      name: flow.name,
      description: flow.description,
      scenarioId: flow.scenarioId,
      scenarioSnapshot: SCENARIO_CONFIGS[scenario] as never,
      nodes: flow.nodes as never,
      edges: flow.edges as never,
    },
  });
  console.log(`  ✅ [发布] "${flow.name}" v${version.version}`);
  return version;
}

async function seedDemoTask(input: {
  scenario: Scenario;
  scenarioId?: string;
  flowId: string;
  flowVersionId: string;
}): Promise<void> {
  if (process.env.SEED_DEMO_TASKS === 'false') return;

  const demo = demoTaskForScenario(input.scenario);
  const existing = await prisma.outboundTask.findFirst({
    where: {
      scenario: input.scenario,
      to: demo.to,
      flowId: input.flowId,
    },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ⏭️  [跳过] demo task ${input.scenario} 已存在 (${existing.id})`);
    return;
  }

  const task = await prisma.outboundTask.create({
    data: {
      to: demo.to,
      from: process.env.FROM_NUMBER ?? '1000',
      scenario: input.scenario,
      scenarioId: input.scenarioId,
      variables: demo.variables as never,
      status: 'pending',
      scheduledAt: nextDemoScheduledAt(),
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
      events: {
        create: {
          type: 'task.created',
          payload: { flowVersionId: input.flowVersionId } as never,
        },
      },
    },
  });
  console.log(`  ✅ [创建] demo task ${input.scenario} (${task.id})`);
}

function demoTaskForScenario(scenario: Scenario): {
  to: string;
  variables: Record<string, string>;
} {
  if (scenario === Scenario.COLLECTION) {
    return {
      to: '1001',
      variables: {
        company: '示例金融',
        product: '信用贷',
        customerName: '王先生',
        last4: '6288',
        amount: '1280',
        days: '5',
      },
    };
  }
  if (scenario === Scenario.PRESALE) {
    return {
      to: '1001',
      variables: {
        company: '示例 4S 店',
        product: '星曜 S7',
        customerName: '赵女士',
        activity: '夏日试驾季',
      },
    };
  }
  return {
    to: '1001',
    variables: {
      company: '示例商城',
      shop: '示例商城',
      customerName: '李女士',
      product: '智能咖啡机',
      orderNo: 'DEMO20260706001',
      date: '2026-07-06',
    },
  };
}

function nextDemoScheduledAt(): Date {
  const date = new Date();
  date.setSeconds(0, 0);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const start = 9 * 60;
  const end = 18 * 60;
  if (date.getDay() >= 1 && date.getDay() <= 5 && minutes >= start && minutes <= end) {
    return date;
  }
  date.setHours(10, 0, 0, 0);
  while (date.getDay() === 0 || date.getDay() === 6 || date.getTime() < Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  await seedAuth();
  await seedGlobalConfig();
  const scenarioIds = await seedScenarios();

  console.log('🌱 Seeding task flows...');

  const seeds = [
    {
      name: '催收标准流程',
      description: '逾期账单催收：问候 → 意图识别 → 分支（同意/协商/转人工）',
      scenario: Scenario.COLLECTION,
      builder: buildCollectionFlow,
    },
    {
      name: '电商回访流程',
      description: '订单回访：确认收货 → 满意度调查 → 分支（满意/售后/物流）',
      scenario: Scenario.ECOMMERCE,
      builder: buildEcommerceFlow,
    },
    {
      name: '汽车售前咨询流程',
      description: '售前咨询：AI 对话 → 意向判断 → 分支（试驾/跟进/短信）',
      scenario: Scenario.PRESALE,
      builder: buildPresaleFlow,
    },
  ];

  for (const seed of seeds) {
    const { nodes, edges } = seed.builder();
    let flow = await prisma.taskFlow.findFirst({
      where: { name: seed.name },
    });
    const scenarioId = scenarioIds.get(seed.scenario);
    if (flow) {
      if (scenarioId && flow.scenarioId !== scenarioId) {
        flow = await prisma.taskFlow.update({
          where: { id: flow.id },
          data: { scenarioId },
        });
      }
      if (scenarioId) {
        await prisma.outboundScenario.update({
          where: { id: scenarioId },
          data: { defaultFlowId: flow.id },
        });
      }
      console.log(`  ⏭️  [跳过] "${seed.name}" 已存在 (id=${flow.id})`);
    } else {
      flow = await prisma.taskFlow.create({
        data: {
          name: seed.name,
          description: seed.description,
          scenarioId,
          status: 'draft',
          nodes: nodes as never,
          edges: edges as never,
        },
      });
      console.log(
        `  ✅ [创建] "${seed.name}" id=${flow.id} (${nodes.length} 节点, ${edges.length} 边)`,
      );
      if (scenarioId) {
        await prisma.outboundScenario.update({
          where: { id: scenarioId },
          data: { defaultFlowId: flow.id },
        });
      }
    }

    const version = await ensurePublishedFlowVersion(flow.id, seed.scenario);
    await seedDemoTask({
      scenario: seed.scenario,
      scenarioId,
      flowId: flow.id,
      flowVersionId: version.id,
    });
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
