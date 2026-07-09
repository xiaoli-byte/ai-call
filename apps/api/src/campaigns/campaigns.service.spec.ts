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

  it('simulates outbound strategy using phone contact history and blocked numbers', async () => {
    const prisma = {
      campaign: {
        findUnique: async () => ({
          id: 'campaign-1',
          retryPolicy: {
            maxAttempts: 3,
            failureReasonRules: {
              NO_ANSWER: { maxAttempts: 2, intervalMinutes: 120 },
            },
          },
          leads: [
            { phoneNumber: '+8613800138000', status: 'imported' },
            { phoneNumber: '+8613800138001', status: 'imported' },
            { phoneNumber: '+8613800138002', status: 'imported' },
          ],
        }),
      },
      contactAttemptHistory: {
        findMany: async () => [
          { phoneNumber: '+8613800138000', outcome: 'NO_ANSWER', attemptedAt: new Date() },
          { phoneNumber: '+8613800138000', outcome: 'NO_ANSWER', attemptedAt: new Date() },
        ],
      },
    };
    const globalConfig = {
      get: async () => ({
        outboundRules: {
          blockedNumbers: [{ phoneNumber: '+8613800138001' }],
          globalWhitelist: [],
          dailyCallLimitPerCallee: 3,
          maxAttemptsPerNumber: 3,
        },
      }),
    };
    const service = new CampaignsService(prisma as any, {} as any, globalConfig as any);

    const result = await service.simulateStrategy('campaign-1');

    assert.equal(result.totalLeads, 3);
    assert.equal(result.callableLeads, 1);
    assert.equal(result.blockedLeads, 2);
    assert.equal(result.blockReasons.some((item) => item.reason === 'blocked_number'), true);
    assert.equal(result.blockReasons.some((item) => item.reason === 'failure_reason_retry_limit'), true);
  });
});

/** 最小 ClsService 假实现：只暴露 get(key)，供 CALL-09 ACL 测试注入 userId/roles。 */
function fakeCls(store: Record<string, unknown>) {
  return { get: (key: string) => store[key] };
}

describe('CampaignsService CALL-09 campaign ACL', () => {
  it('list() applies owner+grant visibility for a non-bypass user', async () => {
    const calls: Array<[string, any]> = [];
    const prisma = {
      campaign: {
        findMany: async (args: any) => {
          calls.push(['campaign.findMany', args]);
          return [];
        },
      },
      resourceGrant: {
        findMany: async (args: any) => {
          calls.push(['resourceGrant.findMany', args]);
          return [{ resourceId: 'granted-campaign', perms: 1 }];
        },
      },
    };
    const cls = fakeCls({ userId: 'u1', roles: ['operator'] });
    const service = new CampaignsService(prisma as any, {} as any, undefined, cls as any);

    await service.list({});

    const [, grantArgs] = calls.find(([name]) => name === 'resourceGrant.findMany')!;
    assert.equal(grantArgs.where.resourceType, 'campaign');

    const [, listArgs] = calls.find(([name]) => name === 'campaign.findMany')!;
    assert.deepEqual(listArgs.where.AND[1], {
      OR: [
        { ownerId: null },
        { ownerId: 'u1' },
        { id: { in: ['granted-campaign'] } },
      ],
    });
  });

  it('list() skips the ACL query entirely for admin', async () => {
    const calls: any[] = [];
    const prisma = {
      campaign: {
        findMany: async (args: any) => {
          calls.push(args);
          return [];
        },
      },
      resourceGrant: {
        findMany: async () => {
          throw new Error('resourceGrant.findMany should not be called for admin');
        },
      },
    };
    const cls = fakeCls({ userId: 'u1', roles: ['admin'] });
    const service = new CampaignsService(prisma as any, {} as any, undefined, cls as any);

    await service.list({});

    assert.deepEqual(calls[0].where.AND[1], {});
  });

  it('create() stamps ownerId from the CLS user', async () => {
    let createdData: any;
    const prisma = {
      campaign: {
        create: async ({ data }: any) => {
          createdData = data;
          return { id: 'c1', ...data, createdAt: new Date(), updatedAt: new Date() };
        },
        findUnique: async () => ({
          id: 'c1', name: 'x', description: '', scenario: Scenario.PRESALE,
          scenarioId: null, flowId: null, status: 'scheduled', scheduledAt: new Date(),
          concurrencyLimit: 3, retryPolicy: {}, endCondition: {},
          createdAt: new Date(), updatedAt: new Date(), leads: [], tasks: [], importBatches: [],
        }),
      },
      leadImportBatch: { create: async ({ data }: any) => ({ id: 'b1', ...data }) },
      campaignLead: {
        create: async ({ data }: any) => ({ id: 'l1', ...data }),
        update: async ({ where, data }: any) => ({ id: where.id, ...data }),
      },
    };
    const tasks = { create: async () => ({ id: 't1' }) };
    const cls = fakeCls({ userId: 'creator-1', roles: ['operator'] });
    const service = new CampaignsService(prisma as any, tasks as any, undefined, cls as any);

    await service.create({
      name: 'x',
      scenario: Scenario.PRESALE,
      leads: [{ phoneNumber: '+8613800138000' }],
    });

    assert.equal(createdData.ownerId, 'creator-1');
  });

  it('assertCampaignVisible allows owner/grantee/admin and denies a stranger with 404', async () => {
    const makePrisma = (grant: any) => ({
      campaign: { findUnique: async () => ({ ownerId: 'owner-1' }) },
      resourceGrant: { findFirst: async () => grant },
    });

    // owner
    const owner = new CampaignsService(
      makePrisma(null) as any, {} as any, undefined,
      fakeCls({ userId: 'owner-1', roles: ['operator'] }) as any,
    );
    await owner.assertCampaignVisible('c1');

    // admin 直接放行（不查库）
    const admin = new CampaignsService(
      makePrisma(null) as any, {} as any, undefined,
      fakeCls({ userId: 'x', roles: ['admin'] }) as any,
    );
    await admin.assertCampaignVisible('c1');

    // 被显式授权的陌生人
    const grantee = new CampaignsService(
      makePrisma({ perms: 1 }) as any, {} as any, undefined,
      fakeCls({ userId: 'stranger', roles: ['operator'] }) as any,
    );
    await grantee.assertCampaignVisible('c1');

    // 无授权的陌生人 → 404
    const stranger = new CampaignsService(
      makePrisma(null) as any, {} as any, undefined,
      fakeCls({ userId: 'stranger', roles: ['operator'] }) as any,
    );
    await assert.rejects(() => stranger.assertCampaignVisible('c1'), /not found/i);
  });
});
