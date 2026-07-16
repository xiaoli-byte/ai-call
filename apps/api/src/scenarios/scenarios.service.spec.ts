import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { FlowStatus, ScenarioStatus } from '@ai-call/shared';
import { ScenariosService } from './scenarios.service.js';

function scenarioRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scenario-1',
    scenario: 'test_scene',
    name: '测试场景',
    description: '',
    status: ScenarioStatus.ACTIVE,
    ttsConfig: {},
    agentIdentity: '',
    communicationStyle: '',
    communicationStylePrompt: '',
    businessGoal: '',
    llmConstraints: [],
    systemPrompt: '',
    greeting: '',
    knowledgeBaseId: '',
    knowledgeBaseIds: [],
    allowedTools: [],
    escalationRules: [],
    dialogRepair: {},
    defaultFlowId: null,
    createdAt: new Date('2026-07-12T00:00:00.000Z'),
    updatedAt: new Date('2026-07-12T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ScenariosService published flow binding', () => {
  it('rejects a flow that has never been published', async () => {
    let created = false;
    const prisma = {
      outboundScenario: {
        findUnique: async () => null,
        create: async () => {
          created = true;
          return scenarioRecord();
        },
      },
      taskFlow: {
        findUnique: async () => ({ status: FlowStatus.DRAFT, version: 0 }),
      },
    };
    const service = new ScenariosService(prisma as any);

    await assert.rejects(
      () => service.create({
        scenario: 'test_scene',
        name: '测试场景',
        defaultFlowId: 'draft-flow',
      }),
      (error: unknown) => error instanceof BadRequestException
        && /只能绑定已发布/.test(error.message),
    );
    assert.equal(created, false);
  });

  it('accepts a draft flow when it still has an executable published version', async () => {
    let createData: Record<string, unknown> | undefined;
    const prisma = {
      outboundScenario: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return scenarioRecord({ defaultFlowId: data.defaultFlowId });
        },
      },
      taskFlow: {
        findUnique: async () => ({ status: FlowStatus.DRAFT, version: 2 }),
      },
    };
    const service = new ScenariosService(prisma as any);

    const created = await service.create({
      scenario: 'test_scene',
      name: '测试场景',
      defaultFlowId: 'published-snapshot-flow',
    });

    assert.equal(createData?.defaultFlowId, 'published-snapshot-flow');
    assert.equal(created.defaultFlowId, 'published-snapshot-flow');
  });
});

describe('ScenariosService dialogRepair 持久化现状', () => {
  // OutboundScenario 表已新增 dialog_repair（Json，默认 '{}'）列，对应 Prisma migration
  // 20260715140556_add_scenario_dialog_repair；toCreateData/toUpdateData/toDomain 会把
  // dialogRepair 当作普通 Json 列读写（空对象在 toDomain 归一化为 undefined，表示未配置）。
  // 以下用例验证创建/更新/读回的完整往返。
  it('create() 持久化 dialogRepair 并在读回时还原', async () => {
    let createData: Record<string, unknown> | undefined;
    const repair = { noInputPrompt: '抱歉，我没有听到您的回答。{question}' };
    const prisma = {
      outboundScenario: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return scenarioRecord({ dialogRepair: data.dialogRepair });
        },
      },
      taskFlow: { findUnique: async () => null },
    };
    const service = new ScenariosService(prisma as any);

    const created = await service.create({
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: repair,
    });

    assert.deepEqual(createData?.dialogRepair, repair);
    assert.deepEqual(created.dialogRepair, repair);
  });

  it('update() 持久化 dialogRepair；未配置（空对象）读回为 undefined', async () => {
    let updateData: Record<string, unknown> | undefined;
    const repair = { noMatchPrompt: '抱歉，我还没理解您的回答。{question}' };
    const prisma = {
      outboundScenario: {
        findFirst: async () => scenarioRecord(),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return scenarioRecord({ dialogRepair: data.dialogRepair });
        },
      },
      taskFlow: { findUnique: async () => null },
    };
    const service = new ScenariosService(prisma as any);

    const updated = await service.update('test_scene', { dialogRepair: repair });
    assert.deepEqual(updateData?.dialogRepair, repair);
    assert.deepEqual(updated.dialogRepair, repair);

    // 空对象 = 全部沿用默认，toDomain 归一化为 undefined
    const cleared = await service.update('test_scene', { dialogRepair: {} });
    assert.equal(cleared.dialogRepair, undefined);
  });
});

describe('ScenariosService knowledge base associations', () => {
  it('writes multiple knowledge bases and keeps the first one in the legacy field', async () => {
    let createData: Record<string, unknown> | undefined;
    const prisma = {
      outboundScenario: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return scenarioRecord(data);
        },
      },
      taskFlow: { findUnique: async () => null },
    };
    const service = new ScenariosService(prisma as any);

    const scenario = await service.create({
      scenario: 'multi_kb_scene',
      name: '多知识库场景',
      knowledgeBaseIds: ['kb-orders', 'kb-products', 'kb-orders', ' '],
    });

    assert.deepEqual(createData?.knowledgeBaseIds, ['kb-orders', 'kb-products']);
    assert.equal(createData?.knowledgeBaseId, 'kb-orders');
    assert.deepEqual(scenario.knowledgeBaseIds, ['kb-orders', 'kb-products']);
    assert.equal(scenario.knowledgeBaseId, 'kb-orders');
  });

  it('reads legacy single knowledge base records as a one-item association', () => {
    const service = new ScenariosService({} as any);
    const scenario = service.toDomain(scenarioRecord({ knowledgeBaseId: 'kb-legacy', knowledgeBaseIds: [] }));

    assert.deepEqual(scenario.knowledgeBaseIds, ['kb-legacy']);
    assert.equal(scenario.knowledgeBaseId, 'kb-legacy');
  });
});
