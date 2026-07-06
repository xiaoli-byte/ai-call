import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallOutcome, Scenario, TaskStatus } from '@ai-call/shared';
import { AnalyticsService } from './analytics.service.js';

describe('AnalyticsService', () => {
  it('aggregates campaign funnel, rates, and failure reasons from tasks and attempts', async () => {
    const prisma = {
      outboundTask: {
        findMany: async () => [
          {
            id: 'task-1',
            status: TaskStatus.COMPLETED,
            outcome: CallOutcome.HIGH_INTENT,
            duration: 120,
            attemptCount: 1,
            campaignId: 'campaign-1',
            scenario: Scenario.PRESALE,
            attempts: [{ status: TaskStatus.COMPLETED, hangupCause: null }],
          },
          {
            id: 'task-2',
            status: TaskStatus.NO_ANSWER,
            outcome: null,
            duration: null,
            attemptCount: 2,
            campaignId: 'campaign-1',
            scenario: Scenario.PRESALE,
            attempts: [{ status: TaskStatus.NO_ANSWER, hangupCause: 'NO_ANSWER' }],
          },
          {
            id: 'task-3',
            status: TaskStatus.CANCELLED,
            outcome: null,
            duration: null,
            attemptCount: 0,
            campaignId: 'campaign-1',
            scenario: Scenario.PRESALE,
            attempts: [],
          },
        ],
      },
    };
    const service = new AnalyticsService(prisma as any);

    const overview = await service.getOverview({ campaignId: 'campaign-1' });

    assert.equal(overview.funnel.totalTasks, 3);
    assert.equal(overview.funnel.dialed, 2);
    assert.equal(overview.funnel.connected, 1);
    assert.equal(overview.funnel.converted, 1);
    assert.equal(overview.rates.connectRate, 50);
    assert.equal(overview.rates.conversionRate, 50);
    assert.equal(overview.failureReasons[0].reason, 'NO_ANSWER');
    assert.equal(overview.campaigns[0].campaignId, 'campaign-1');
  });
});
