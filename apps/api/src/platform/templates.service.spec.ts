import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TemplatesService } from './templates.service.js';

describe('TemplatesService', () => {
  it('clones an industry template into a scenario and published flow', async () => {
    const calls: string[] = [];
    const prisma = {
      outboundScenario: {
        findUnique: async () => null,
      },
      $transaction: async (work: (tx: any) => Promise<unknown>) => work({
        outboundScenario: {
          create: async ({ data }: any) => {
            calls.push(`scenario.create:${data.scenario}`);
            return {
              id: 'scenario-1',
              scenario: data.scenario,
              name: data.name,
              description: data.description,
              status: data.status,
              systemPrompt: data.systemPrompt,
              greeting: data.greeting,
              knowledgeBaseId: data.knowledgeBaseId,
            };
          },
          update: async () => {
            calls.push('scenario.update');
          },
        },
        taskFlow: {
          create: async ({ data }: any) => {
            calls.push(`flow.create:${data.status}`);
            return {
              id: 'flow-1',
              name: data.name,
              description: data.description,
            };
          },
        },
        taskFlowVersion: {
          create: async ({ data }: any) => {
            calls.push(`version.create:${data.version}`);
            return { id: 'version-1' };
          },
        },
      }),
    };
    const service = new TemplatesService(prisma as any);

    const result = await service.cloneTemplate('ecommerce_after_sale', { publish: true });

    assert.deepEqual(result, {
      templateId: 'ecommerce_after_sale',
      scenarioId: 'scenario-1',
      scenarioKey: 'ecommerce_after_sale',
      flowId: 'flow-1',
      flowVersionId: 'version-1',
    });
    assert.deepEqual(calls, [
      'scenario.create:ecommerce_after_sale',
      'flow.create:published',
      'version.create:1',
      'scenario.update',
    ]);
  });
});
