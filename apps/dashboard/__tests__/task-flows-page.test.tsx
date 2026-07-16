import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowStatus } from '@ai-call/shared';

const mocks = vi.hoisted(() => ({
  flows: [] as any[],
  error: undefined as unknown,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
  publish: vi.fn(),
  duplicate: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// FlowRowActions/NewFlowLink/NewFlowEmptyLink 都从这个模块取 mutation hook，
// 一并 mock 掉避免测试时发出真实网络请求。
vi.mock('@/hooks/use-task-flows', () => ({
  useTaskFlows: () => ({
    data: mocks.flows,
    error: mocks.error,
    isLoading: mocks.isLoading,
    isValidating: mocks.isValidating,
    mutate: mocks.mutate,
  }),
  useTaskFlowMutations: () => ({
    publish: mocks.publish,
    duplicate: mocks.duplicate,
    remove: mocks.remove,
  }),
}));

vi.mock('@/lib/toast', () => ({
  appToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import TaskFlowsPage from '../app/task-flows/page';

function flow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'flow-1',
    name: '默认流程',
    description: '',
    status: FlowStatus.DRAFT,
    version: 1,
    nodes: [],
    edges: [],
    scenarioId: undefined,
    scenarioConfig: undefined,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

// 表格行名称按渲染顺序取出，跳过表头行
function rowNames() {
  const rows = screen.getAllByRole('row').slice(1);
  return rows.map((row) => within(row).getByRole('link').textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flows = [];
  mocks.error = undefined;
  mocks.isLoading = false;
  mocks.isValidating = false;
});

describe('/task-flows 列表页', () => {
  it('按名称关键字过滤流程', () => {
    mocks.flows = [
      flow({ id: 'a', name: '催收提醒流程' }),
      flow({ id: 'b', name: '满意度回访流程' }),
    ];
    render(<TaskFlowsPage />);

    fireEvent.change(screen.getByLabelText('按名称搜索流程'), { target: { value: '催收' } });

    expect(rowNames()).toEqual(['催收提醒流程']);
    expect(screen.queryByText('满意度回访流程')).toBeNull();
  });

  it('按状态筛选（草稿/已发布）', () => {
    mocks.flows = [
      flow({ id: 'a', name: '草稿流程', status: FlowStatus.DRAFT }),
      flow({ id: 'b', name: '已发布流程', status: FlowStatus.PUBLISHED }),
    ];
    render(<TaskFlowsPage />);

    fireEvent.change(screen.getByLabelText('按状态筛选'), {
      target: { value: FlowStatus.PUBLISHED },
    });

    expect(rowNames()).toEqual(['已发布流程']);
  });

  it('按绑定场景筛选，支持筛选“未绑定”', () => {
    mocks.flows = [
      flow({ id: 'a', name: '场景A流程', scenarioId: 'sc-a', scenarioConfig: { name: '场景A' } }),
      flow({ id: 'b', name: '场景B流程', scenarioId: 'sc-b', scenarioConfig: { name: '场景B' } }),
      flow({ id: 'c', name: '未绑定流程', scenarioId: undefined, scenarioConfig: undefined }),
    ];
    render(<TaskFlowsPage />);

    const select = screen.getByLabelText('按绑定场景筛选');
    fireEvent.change(select, { target: { value: 'sc-a' } });
    expect(rowNames()).toEqual(['场景A流程']);

    fireEvent.change(select, { target: { value: '__unbound__' } });
    expect(rowNames()).toEqual(['未绑定流程']);
  });

  it('更新时间排序默认新→旧，点击表头可翻转顺序', () => {
    mocks.flows = [
      flow({ id: 'old', name: '较早更新', updatedAt: '2026-07-01T00:00:00.000Z' }),
      flow({ id: 'new', name: '较晚更新', updatedAt: '2026-07-10T00:00:00.000Z' }),
    ];
    render(<TaskFlowsPage />);

    expect(rowNames()).toEqual(['较晚更新', '较早更新']);

    // 默认已按更新时间降序，表头文字后面带 “↓” 指示符，故用可访问名正则匹配而非精确文本
    fireEvent.click(screen.getByRole('columnheader', { name: /更新时间/ }));
    expect(rowNames()).toEqual(['较早更新', '较晚更新']);
  });

  it('点击刷新按钮触发 SWR mutate 重新拉取', () => {
    mocks.flows = [flow()];
    render(<TaskFlowsPage />);

    fireEvent.click(screen.getByLabelText('刷新'));

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
});
