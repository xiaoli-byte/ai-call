import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FlowStatus } from '@ai-call/shared';
import { TaskFlowsService } from './task-flows.service.js';

/**
 * 回归测试：编辑已发布流程后无法再次发布的 bug。
 *
 * 复现路径是「列表进入已发布流程编辑页 → 自动保存 → 状态仍显示已发布，发布按钮不可点」。
 * 排查后确认 TaskFlowsService.update() 本身已经正确地把 PUBLISHED 流程在内容变更时
 * 转回 DRAFT（详见下方用例）；真正的 bug 在前端渲染链路——编辑页的 flowStatus 是
 * Server Component 首屏渲染时传下的静态 prop，自动保存只更新了 SWR 缓存，没有触发
 * 该 prop 重新读取，因此界面一直显示旧的“已发布”状态（修复点在
 * apps/dashboard/components/flow-builder/** 内，不在本次改动范围）。
 * 这里锁定 API 侧已经正确的行为，防止后续误改回归。
 */
function flowRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flow-1',
    name: '流程A',
    description: '',
    scenarioId: null,
    scenarioConfig: null,
    status: FlowStatus.PUBLISHED,
    nodes: [],
    edges: [],
    version: 1,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(record: Record<string, unknown>) {
  let updateData: Record<string, unknown> | undefined;
  const prisma = {
    taskFlow: {
      findUnique: async () => record,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updateData = data;
        return { ...record, ...data };
      },
    },
  };
  const service = new TaskFlowsService(
    prisma as any,
    {} as any,
    { toDomain: () => undefined } as any,
  );
  return { service, getUpdateData: () => updateData };
}

describe('TaskFlowsService.update 已发布流程回退草稿', () => {
  it('修改已发布流程的节点内容会把 status 转回 draft', async () => {
    const { service, getUpdateData } = buildService(flowRecord());

    const updated = await service.update('flow-1', {
      nodes: [{ id: 'n1', type: 'start', position: { x: 0, y: 0 }, data: {} }] as any,
    });

    assert.equal(getUpdateData()?.status, FlowStatus.DRAFT);
    assert.equal(updated.status, FlowStatus.DRAFT);
  });

  it('只改名称/描述/绑定场景（不改节点连线）同样会把已发布流程转回草稿', async () => {
    const { service, getUpdateData } = buildService(flowRecord());

    await service.update('flow-1', { name: '重命名后的流程' });

    assert.equal(getUpdateData()?.status, FlowStatus.DRAFT);
  });

  it('已经是草稿的流程编辑内容不会多余地写入 status 字段', async () => {
    const { service, getUpdateData } = buildService(flowRecord({ status: FlowStatus.DRAFT }));

    await service.update('flow-1', { nodes: [] as any });

    assert.equal(getUpdateData()?.status, undefined);
  });
});
