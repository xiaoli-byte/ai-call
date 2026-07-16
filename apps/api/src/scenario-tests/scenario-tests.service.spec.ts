import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ScenarioTestsService } from './scenario-tests.service.js';

describe('ScenarioTestsService', () => {
  it('runs a golden scenario test and stores node path, knowledge hits, result, and risk items', async () => {
    let createdRun: any;
    const prisma = {
      scenarioTestRun: {
        create: async ({ data }: any) => {
          createdRun = data;
          return {
            id: 'run-1',
            ...data,
            createdAt: new Date('2026-07-07T08:00:00.000Z'),
          };
        },
        findMany: async () => [],
      },
    };
    const scenarios = {
      get: async () => ({
        id: 'scenario-1',
        scenario: 'collection',
        name: '贷后催收',
        knowledgeBaseId: 'kb-collection',
        knowledgeBaseIds: ['kb-collection'],
        escalationRules: [{ description: '客户提出延期', keywords: ['延期'] }],
      }),
    };
    const flows = {
      testFlow: async () => ({
        flowId: 'flow-1',
        flowName: '催收流程',
        nodeCount: 3,
        edgeCount: 2,
        entryNode: 'start',
        aiDialogNode: { nodeId: 'dialog-1' },
        input: '我想申请延期',
        reply: '我帮您转人工处理延期申请。',
      }),
    };
    const knowledge = {
      retrieveMany: async () => [
        { id: 'doc-1', source: '延期政策.pdf', content: '最长延期 90 天', score: 0.92 },
      ],
    };
    const service = new ScenarioTestsService(
      prisma as any,
      scenarios as any,
      flows as any,
      knowledge as any,
    );

    const run = await service.run('collection', {
      flowId: 'flow-1',
      input: '我想申请延期',
      expectedOutcome: 'handoff',
      golden: true,
    });

    assert.equal(run.id, 'run-1');
    assert.equal(run.result, 'pass');
    assert.equal(run.knowledgeHits[0].source, '延期政策.pdf');
    assert.equal(createdRun.scenarioKey, 'collection');
    assert.equal(createdRun.flowId, 'flow-1');
    assert.equal(createdRun.golden, true);
  });

  it('warns when a knowledge-bound scenario has low retrieval confidence', async () => {
    const prisma = {
      scenarioTestRun: {
        create: async ({ data }: any) => ({
          id: 'run-low-confidence',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
    };
    const scenarios = {
      get: async () => ({
        id: 'scenario-1',
        scenario: 'collection',
        name: '催收提醒',
        greeting: '您好，请描述您的问题。',
        knowledgeBaseId: 'kb-collection',
        knowledgeBaseIds: ['kb-collection'],
        escalationRules: [],
      }),
    };
    const flows = {};
    const knowledge = {
      retrieveMany: async () => [
        { id: 'doc-1', source: '还款政策.pdf', content: '可申请延期还款。', score: 0.2 },
      ],
    };
    const service = new ScenarioTestsService(
      prisma as any,
      scenarios as any,
      flows as any,
      knowledge as any,
    );

    const run = await service.run('collection', {
      input: '我想了解延期还款政策',
      golden: true,
    });

    assert.equal(run.result, 'warning');
    assert.deepEqual(run.riskItems, ['知识库检索置信度低']);
  });

  it('passes a scenario without knowledge base when no other risks are present', async () => {
    let retrieveCalls = 0;
    const prisma = {
      scenarioTestRun: {
        create: async ({ data }: any) => ({
          id: 'run-no-kb',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
    };
    const scenarios = {
      get: async () => ({
        id: 'scenario-1',
        scenario: 'notification',
        name: '通知提醒',
        greeting: '您好，这里是预约提醒。',
        knowledgeBaseId: undefined,
        knowledgeBaseIds: [],
        escalationRules: [],
      }),
    };
    const flows = {};
    const knowledge = {
      retrieveMany: async () => {
        retrieveCalls += 1;
        return [];
      },
    };
    const service = new ScenarioTestsService(
      prisma as any,
      scenarios as any,
      flows as any,
      knowledge as any,
    );

    const run = await service.run('notification', {
      input: '确认一下预约时间',
      golden: true,
    });

    assert.equal(run.result, 'pass');
    assert.deepEqual(run.riskItems, []);
    assert.equal(retrieveCalls, 0);
  });

  it('fails when expected handoff is not reflected in the default reply', async () => {
    const prisma = {
      scenarioTestRun: {
        create: async ({ data }: any) => ({
          id: 'run-missing-handoff',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
    };
    const scenarios = {
      get: async () => ({
        id: 'scenario-1',
        scenario: 'notification',
        name: '通知提醒',
        greeting: '您好，请描述您的问题。',
        knowledgeBaseId: undefined,
        knowledgeBaseIds: [],
        escalationRules: [],
      }),
    };
    const flows = {};
    const knowledge = {
      retrieveMany: async () => [],
    };
    const service = new ScenarioTestsService(
      prisma as any,
      scenarios as any,
      flows as any,
      knowledge as any,
    );

    const run = await service.run('notification', {
      input: '我需要升级处理这个问题',
      expectedOutcome: 'handoff',
      golden: true,
    });

    assert.equal(run.result, 'fail');
    assert.deepEqual(run.riskItems, ['未命中预期转人工结果']);
  });

  it('combines hits from every associated knowledge base', async () => {
    let receivedIds: string[] = [];
    const prisma = {
      scenarioTestRun: {
        create: async ({ data }: any) => ({
          id: 'run-multi-kb',
          ...data,
          createdAt: new Date('2026-07-07T08:00:00.000Z'),
        }),
      },
    };
    const scenarios = {
      get: async () => ({
        scenario: 'support',
        name: '售后支持',
        greeting: '您好，请说明您的问题。',
        knowledgeBaseId: 'kb-orders',
        knowledgeBaseIds: ['kb-orders', 'kb-products'],
        escalationRules: [],
      }),
    };
    const knowledge = {
      retrieveMany: async (ids: string[]) => {
        receivedIds = ids;
        return [{ id: 'doc-1', source: 'products.md', content: '产品说明', score: 0.9 }];
      },
    };
    const service = new ScenarioTestsService(prisma as any, scenarios as any, {} as any, knowledge as any);

    await service.run('support', { input: '产品如何使用' });

    assert.deepEqual(receivedIds, ['kb-orders', 'kb-products']);
  });
});
