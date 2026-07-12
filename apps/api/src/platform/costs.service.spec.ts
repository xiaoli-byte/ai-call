import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CostsService } from './costs.service.js';

describe('CostsService', () => {
  it('estimates provider and scenario costs from call duration and transcripts', async () => {
    const prisma = {
      outboundTask: {
        findMany: async () => [
          {
            id: 'task-1',
            scenario: 'ecommerce',
            duration: 120,
            createdAt: new Date('2026-07-07T01:00:00.000Z'),
            attempts: [],
            transcripts: [
              { role: 'user', content: 'Package received, but an accessory has an issue.' },
              { role: 'assistant', content: 'I recorded the after-sales issue and arranged follow-up.' },
            ],
          },
        ],
      },
      toolCallLog: { count: async () => 2 },
      usageAggregate: { findMany: async () => [] },
    };
    const service = new CostsService(prisma as any);

    const overview = await service.getOverview();

    assert.equal(overview.summary.callCount, 1);
    assert.equal(overview.summary.connectedCalls, 1);
    assert.equal(overview.summary.totalSeconds, 120);
    assert.equal(overview.scenarios[0].scenario, 'ecommerce');
    assert.ok(overview.summary.totalCost > 0);
    assert.ok(overview.providers.some((provider) => provider.component === 'tool' && provider.toolCalls === 2));
  });
});
