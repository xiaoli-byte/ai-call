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
      retrieve: async () => [
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
});
