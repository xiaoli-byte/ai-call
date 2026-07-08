import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import {
  applyTenantScope,
  injectTenant,
  TENANT_MODELS,
  type TenantScopeCls,
} from './tenant-extension.js';
import { SYSTEM_BYPASS_CLS_KEY, TENANT_CLS_KEY } from './system-context.js';

/** 最小 CLS 假实现：只暴露 get(key)。 */
function fakeCls(store: Record<string, unknown>): TenantScopeCls {
  return { get: <T>(key: string) => store[key] as T | undefined };
}

/** 捕获传给 query 的 args，返回一个标记值以确认 query 被调用。 */
function capturingQuery() {
  const calls: unknown[] = [];
  const query = (args: unknown) => {
    calls.push(args);
    return 'RESULT';
  };
  return { query, calls };
}

describe('injectTenant', () => {
  it('补 data.tenantId 到 create', () => {
    const out = injectTenant('create', { data: { name: 'x' } }, 't1');
    assert.deepEqual(out.data, { name: 'x', tenantId: 't1' });
  });

  it('不覆盖 create 里已存在的 tenantId', () => {
    const out = injectTenant('create', { data: { tenantId: 'explicit' } }, 't1');
    assert.deepEqual(out.data, { tenantId: 'explicit' });
  });

  it('给 createMany 每行补 tenantId', () => {
    const out = injectTenant('createMany', { data: [{ a: 1 }, { a: 2, tenantId: 'keep' }] }, 't1');
    assert.deepEqual(out.data, [
      { a: 1, tenantId: 't1' },
      { a: 2, tenantId: 'keep' },
    ]);
  });

  it('把单个 createMany data 对象规整为数组并补 tenantId', () => {
    const out = injectTenant('createMany', { data: { a: 1 } }, 't1');
    assert.deepEqual(out.data, [{ a: 1, tenantId: 't1' }]);
  });

  it('upsert 同时约束 where 和 create', () => {
    const out = injectTenant('upsert', { where: { id: 'x' }, create: { name: 'n' } }, 't1');
    assert.deepEqual(out.where, { id: 'x', tenantId: 't1' });
    assert.deepEqual(out.create, { name: 'n', tenantId: 't1' });
  });

  it('给 findUnique/update/delete 的 where 合并 tenantId（Prisma7 extendedWhereUnique）', () => {
    for (const op of ['findUnique', 'update', 'delete']) {
      const out = injectTenant(op, { where: { id: 'x' } }, 't1');
      assert.deepEqual(out.where, { id: 'x', tenantId: 't1' }, `op=${op}`);
    }
  });

  it('给 findMany 的空 where 注入 tenantId', () => {
    const out = injectTenant('findMany', {}, 't1');
    assert.deepEqual(out.where, { tenantId: 't1' });
  });

  it('给 findMany 无 args 时也注入 tenantId', () => {
    const out = injectTenant('findMany', undefined, 't1');
    assert.deepEqual(out.where, { tenantId: 't1' });
  });
});

describe('applyTenantScope', () => {
  it('非租户模型：原样放行，不改 args', () => {
    const { query, calls } = capturingQuery();
    const args = { where: { id: 'u1' } };
    const res = applyTenantScope(fakeCls({ [TENANT_CLS_KEY]: 't1' }), {
      model: 'User',
      operation: 'findUnique',
      args,
      query,
    });
    assert.equal(res, 'RESULT');
    assert.equal(calls[0], args); // 同一引用，未注入
  });

  it('系统旁路：租户模型也原样放行', () => {
    const { query, calls } = capturingQuery();
    const args = { where: {} };
    applyTenantScope(fakeCls({ [SYSTEM_BYPASS_CLS_KEY]: true }), {
      model: 'OutboundTask',
      operation: 'findMany',
      args,
      query,
    });
    assert.equal(calls[0], args); // 未注入
  });

  it('有 tenantId：注入 where 后调用 query', () => {
    const { query, calls } = capturingQuery();
    applyTenantScope(fakeCls({ [TENANT_CLS_KEY]: 't1' }), {
      model: 'OutboundTask',
      operation: 'findMany',
      args: { where: { status: 'pending' } },
      query,
    });
    assert.deepEqual(calls[0], { where: { status: 'pending', tenantId: 't1' } });
  });

  it('租户模型的 create 补 tenantId', () => {
    const { query, calls } = capturingQuery();
    applyTenantScope(fakeCls({ [TENANT_CLS_KEY]: 't1' }), {
      model: 'CallEvent',
      operation: 'create',
      args: { data: { type: 'x' } },
      query,
    });
    assert.deepEqual(calls[0], { data: { type: 'x', tenantId: 't1' } });
  });

  it('无 tenantId 且非系统上下文：fail-closed 抛 ForbiddenException', () => {
    const { query } = capturingQuery();
    assert.throws(
      () =>
        applyTenantScope(fakeCls({}), {
          model: 'OutboundTask',
          operation: 'findMany',
          args: {},
          query,
        }),
      ForbiddenException,
    );
  });

  it('所有 16 张目标模型都在强制过滤集合内', () => {
    assert.equal(TENANT_MODELS.size, 16);
    for (const m of [
      'OutboundScenario',
      'TaskFlow',
      'TaskFlowVersion',
      'OutboundTask',
      'CallAttempt',
      'Campaign',
      'KnowledgeDocument',
      'TranscriptTurn',
      'CallEvent',
      'CallAnalysis',
      'HandoffTicket',
      'CampaignLead',
      'LeadImportBatch',
      'ContactAttemptHistory',
      'ScenarioTestRun',
      'ResourceGrant',
    ]) {
      assert.ok(TENANT_MODELS.has(m), `missing ${m}`);
    }
  });
});
