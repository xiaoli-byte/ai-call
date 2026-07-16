import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WebDemoController } from './web-demo.controller.js';
import { TENANT_CLS_KEY } from '../prisma/system-context.js';
import type { TasksService } from './tasks.service.js';
import type { TaskFlowsService } from '../task-flows/task-flows.service.js';
import type { ClsService } from 'nestjs-cls';

/**
 * 首页匿名模拟外呼公开端点（/web-demo/*）安全边界测试：
 *  - flows 只返回已发布（或 version>0）流程的 id/name/scenario，不泄露流程定义；
 *  - calls 服务端强制 to=1001、channel='web'，未发布流程 404；
 *  - 同 IP 超限 429。
 */

function buildController(overrides?: {
  flows?: unknown[];
  getFlow?: (id: string) => unknown;
  cls?: ClsService;
}) {
  const created: Record<string, unknown>[] = [];
  const dispatched: { id: string; channel: string }[] = [];

  const tasksService = {
    create: async (dto: Record<string, unknown>) => {
      created.push(dto);
      return { id: 'task-1' };
    },
    dispatch: async (id: string, channel: string) => {
      dispatched.push({ id, channel });
      return { attemptId: 'attempt-1', status: 'CALLING' };
    },
  } as unknown as TasksService;

  const defaultFlow = {
    id: 'flow-pub',
    name: '电商回访流程',
    status: 'published',
    version: 1,
    scenarioConfig: { scenario: 'ecommerce' },
    nodes: [{ id: 'secret-node' }],
  };
  const taskFlowsService = {
    list: async () => overrides?.flows ?? [defaultFlow],
    get: async (id: string) => {
      const flow = overrides?.getFlow ? overrides.getFlow(id) : defaultFlow;
      if (!flow) throw new Error('not found');
      return flow;
    },
  } as unknown as TaskFlowsService;

  return {
    controller: new WebDemoController(tasksService, taskFlowsService, overrides?.cls),
    created,
    dispatched,
  };
}

describe('WebDemoController（匿名公开端点）', () => {
  it('flows：只返回已发布或有已发布快照的流程，且裁剪为 id/name/scenario', async () => {
    const { controller } = buildController({
      flows: [
        { id: 'a', name: '已发布', status: 'published', version: 1, scenarioConfig: { scenario: 'ecommerce' }, nodes: [{}] },
        { id: 'b', name: '编辑中的已发布流程', status: 'draft', version: 2, scenarioConfig: null },
        { id: 'c', name: '从未发布的草稿', status: 'draft', version: 0 },
      ],
    });

    const result = await controller.listFlows();

    assert.deepEqual(result, [
      { id: 'a', name: '已发布', scenario: 'ecommerce' },
      { id: 'b', name: '编辑中的已发布流程', scenario: null },
    ]);
    // 不泄露流程定义字段
    assert.equal('nodes' in (result[0] as Record<string, unknown>), false);
  });

  it('calls：强制 to=1001 与 web 通道，返回 taskId/attemptId', async () => {
    const { controller, created, dispatched } = buildController();

    const result = await controller.startCall(
      { flowId: '00000000-0000-4000-8000-000000000001' },
      '127.0.0.1',
      undefined,
    );

    assert.equal(created[0]?.to, '1001');
    assert.equal(created[0]?.scenario, 'ecommerce');
    assert.deepEqual(dispatched, [{ id: 'task-1', channel: 'web' }]);
    assert.deepEqual(result, { taskId: 'task-1', attemptId: 'attempt-1', status: 'CALLING' });
  });

  it('calls：未发布流程（draft 且 version=0）→ 404', async () => {
    const { controller } = buildController({
      getFlow: () => ({ id: 'flow-draft', name: '草稿', status: 'draft', version: 0 }),
    });

    await assert.rejects(
      controller.startCall({ flowId: '00000000-0000-4000-8000-000000000002' }, '127.0.0.1', undefined),
      (err: { status?: number }) => err.status === 404,
    );
  });

  it('在 demo 租户 CLS 上下文中执行（CALL-03 显式绑定，而非系统 bypass）', async () => {
    const sets: Array<[string, unknown]> = [];
    const cls = {
      isActive: () => true,
      set: (key: string, value: unknown) => sets.push([key, value]),
      run: (fn: () => unknown) => fn(),
    } as unknown as ClsService;
    const { controller } = buildController({ cls });

    await controller.listFlows();

    assert.deepEqual(sets, [[TENANT_CLS_KEY, 'tenant_demo']]);
  });

  it('calls：同 IP 超过窗口内限额 → 429，另一 IP 不受影响', async () => {
    const { controller } = buildController();
    const dto = { flowId: '00000000-0000-4000-8000-000000000001' };

    for (let i = 0; i < 6; i++) {
      await controller.startCall(dto, '10.0.0.1', undefined);
    }
    await assert.rejects(
      controller.startCall(dto, '10.0.0.1', undefined),
      (err: { status?: number }) => err.status === 429,
    );
    // X-Forwarded-For 优先于 socket IP：伪装同一转发链路仍按首个 IP 计数
    await assert.rejects(
      controller.startCall(dto, '127.0.0.1', '10.0.0.1, 172.16.0.1'),
      (err: { status?: number }) => err.status === 429,
    );
    // 其他 IP 正常
    const ok = await controller.startCall(dto, '10.0.0.2', undefined);
    assert.equal(ok.taskId, 'task-1');
  });
});
