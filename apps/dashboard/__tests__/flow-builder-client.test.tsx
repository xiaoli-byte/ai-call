import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlowStatus } from '@ai-call/shared';

const mocks = vi.hoisted(() => ({
  liveFlow: undefined as any,
  builderProps: null as any,
}));

vi.mock('@/components/flow-builder/flow-builder', () => ({
  FlowBuilder: (props: any) => {
    mocks.builderProps = props;
    return <div data-testid="flow-builder">{props.flowStatus}</div>;
  },
}));

vi.mock('@/hooks/use-task-flows', () => ({
  useTaskFlow: () => ({ data: mocks.liveFlow }),
}));

import { FlowBuilderClient } from '../app/task-flows/[id]/FlowBuilderClient';

function flow(status: string, version = 1) {
  return {
    id: 'flow-1',
    name: '测试流程',
    description: '',
    status,
    version,
    nodes: [],
    edges: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  } as any;
}

describe('FlowBuilderClient 状态订阅', () => {
  it('SWR 缓存无更新时使用服务端初始状态', () => {
    mocks.liveFlow = undefined;
    render(<FlowBuilderClient flow={flow(FlowStatus.PUBLISHED)} />);
    expect(screen.getByTestId('flow-builder').textContent).toBe(FlowStatus.PUBLISHED);
  });

  it('自动保存把已发布流程降级为草稿后，flowStatus 响应式更新（发布按钮解锁的前提）', () => {
    // 模拟 useTaskFlowMutations().update 写回 SWR 缓存后的最新流程
    mocks.liveFlow = flow(FlowStatus.DRAFT, 2);
    render(<FlowBuilderClient flow={flow(FlowStatus.PUBLISHED, 1)} />);
    expect(screen.getByTestId('flow-builder').textContent).toBe(FlowStatus.DRAFT);
    expect(mocks.builderProps.flowVersion).toBe(2);
  });
});
