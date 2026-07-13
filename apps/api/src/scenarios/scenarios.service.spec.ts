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
    allowedTools: [],
    escalationRules: [],
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
