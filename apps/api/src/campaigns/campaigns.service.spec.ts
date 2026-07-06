import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { Scenario, TaskPriority, TaskStatus } from '@ai-call/shared';
import { CampaignsService } from './campaigns.service.js';

describe('CampaignsService', () => {
  it('creates a campaign, import batch, valid leads, and outbound tasks', async () => {
    const createdTasks: any[] = [];
    const prisma = {
      campaign: {
        create: async ({ data }: any) => ({
          id: 'campaign-1',
          ...data,
          status: 'scheduled',
          createdAt: new Date('2026-07-06T08:00:00.000Z'),
          updatedAt: new Date('2026-07-06T08:00:00.000Z'),
        }),
        update: async ({ data }: any) => ({
          id: 'campaign-1',
          name: '七月试驾邀约',
          scenario: Scenario.PRESALE,
          status: data.status,
          createdAt: new Date('2026-07-06T08:00:00.000Z'),
          updatedAt: new Date('2026-07-06T08:00:00.000Z'),
        }),
        findUnique: async () => ({
          id: 'campaign-1',
          name: '七月试驾邀约',
          description: '',
          scenario: Scenario.PRESALE,
          scenarioId: null,
          flowId: 'flow-1',
          status: 'scheduled',
          scheduledAt: new Date('2026-07-06T09:30:00.000Z'),
          concurrencyLimit: 3,
          retryPolicy: { maxAttempts: 2 },
          endCondition: {},
          createdAt: new Date('2026-07-06T08:00:00.000Z'),
          updatedAt: new Date('2026-07-06T08:00:00.000Z'),
          leads: [
            { id: 'lead-1', status: 'scheduled' },
            { id: 'lead-2', status: 'invalid' },
          ],
          tasks: [
            { status: TaskStatus.PENDING, outcome: null, duration: null, attemptCount: 0 },
          ],
          importBatches: [{ id: 'batch-1', totalRows: 2, validRows: 1, invalidRows: 1 }],
        }),
      },
      leadImportBatch: {
        create: async ({ data }: any) => ({ id: 'batch-1', ...data }),
      },
      campaignLead: {
        create: async ({ data }: any) => ({ id: `lead-${data.rowNumber}`, ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, ...data }),
      },
    };
    const tasks = {
      create: async (dto: any) => {
        createdTasks.push(dto);
        return { id: `task-${createdTasks.length}` };
      },
    };
    const service = new CampaignsService(prisma as any, tasks as any);

    const result = await service.create({
      name: '七月试驾邀约',
      scenario: Scenario.PRESALE,
      flowId: 'flow-1',
      scheduledAt: '2026-07-06T09:30:00.000Z',
      concurrencyLimit: 3,
      retryPolicy: { maxAttempts: 2 },
      leads: [
        { phoneNumber: '+8613800138000', name: '王先生', variables: { city: '上海' } },
        { phoneNumber: 'not-a-phone', name: '坏号码' },
      ],
    });

    assert.equal(result.id, 'campaign-1');
    assert.equal(result.stats.totalLeads, 2);
    assert.equal(result.stats.validLeads, 1);
    assert.equal(result.stats.invalidLeads, 1);
    assert.equal(createdTasks.length, 1);
    assert.equal(createdTasks[0].campaignId, 'campaign-1');
    assert.equal(createdTasks[0].campaignLeadId, 'lead-1');
    assert.equal(createdTasks[0].priority, TaskPriority.NORMAL);
    assert.equal(createdTasks[0].variables.customerName, '王先生');
  });

  it('rejects a campaign when every imported lead is invalid', async () => {
    const service = new CampaignsService({} as any, {} as any);

    await assert.rejects(
      () => service.create({
        name: '无效活动',
        scenario: Scenario.PRESALE,
        leads: [{ phoneNumber: 'abc' }],
      }),
      BadRequestException,
    );
  });
});
