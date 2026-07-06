import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_OUTBOUND_RULES } from '@ai-call/shared';
import { ComplianceService } from './compliance.service.js';

describe('ComplianceService', () => {
  it('returns policy summary from global outbound rules', async () => {
    const globalConfig = {
      get: async () => ({
        id: 'default',
        globalVariables: [],
        apiPlugins: [],
        outboundRules: {
          ...DEFAULT_OUTBOUND_RULES,
          dailyCallLimitPerCallee: 2,
          blockedNumbers: [{ phoneNumber: '+8613800138000' }],
          globalWhitelist: [{ phoneNumber: '+8613800138001' }],
          aiDisclosureTemplate: '您好，我是 AI 外呼助手。',
        },
      }),
    };
    const service = new ComplianceService({ complianceAuditLog: { findMany: async () => [] } } as any, globalConfig as any);

    const summary = await service.getPolicy();

    assert.equal(summary.dailyCallLimitPerCallee, 2);
    assert.equal(summary.blockedNumberCount, 1);
    assert.equal(summary.whitelistCount, 1);
    assert.equal(summary.aiDisclosureTemplate, '您好，我是 AI 外呼助手。');
  });

  it('updates outbound rules and records an audit log', async () => {
    let auditPayload: any;
    const prisma = {
      complianceAuditLog: {
        create: async ({ data }: any) => {
          auditPayload = data;
          return data;
        },
      },
    };
    const globalConfig = {
      update: async (dto: any) => ({
        id: 'default',
        globalVariables: [],
        apiPlugins: [],
        outboundRules: dto.outboundRules,
      }),
    };
    const service = new ComplianceService(prisma as any, globalConfig as any);

    await service.updatePolicy({
      outboundRules: {
        ...DEFAULT_OUTBOUND_RULES,
        dailyCallLimitPerCallee: 5,
      },
      reason: '试点活动频控调整',
    }, { id: 'user-1', name: '运营主管', email: 'ops@example.test', status: 'active', roles: [], permissions: [] });

    assert.equal(auditPayload.action, 'compliance.policy_updated');
    assert.equal(auditPayload.actorId, 'user-1');
    assert.equal(auditPayload.actorName, '运营主管');
    assert.equal(auditPayload.details.reason, '试点活动频控调整');
  });
});
