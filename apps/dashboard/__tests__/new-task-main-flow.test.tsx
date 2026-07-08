import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FlowStatus,
  ScenarioStatus,
  TaskPriority,
  type ScenarioConfig,
  type TaskFlow,
} from '@ai-call/shared';

const mockRuntime = vi.hoisted(() => ({
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  createBatch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockRuntime.routerBack,
    push: mockRuntime.routerPush,
  }),
}));

vi.mock('@/hooks/use-scenarios', () => ({
  useScenarios: vi.fn(),
}));

vi.mock('@/hooks/use-global-config', () => ({
  useGlobalConfig: vi.fn(),
}));

vi.mock('@/hooks/use-task-flows', () => ({
  useTaskFlows: vi.fn(),
}));

vi.mock('@/hooks/use-tasks', () => ({
  useTaskMutations: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  appToast: {
    error: mockRuntime.toastError,
    success: mockRuntime.toastSuccess,
  },
}));

import NewTaskPage from '@/app/tasks/new/page';
import { normalizeDateTime } from '@/app/tasks/new/import-parser';
import { useGlobalConfig } from '@/hooks/use-global-config';
import { useScenarios } from '@/hooks/use-scenarios';
import { useTaskFlows } from '@/hooks/use-task-flows';
import { useTaskMutations } from '@/hooks/use-tasks';

const activeScenario: ScenarioConfig = {
  id: 'scenario-presale',
  scenario: 'presale',
  name: '售前邀约',
  description: '试驾邀约场景',
  status: ScenarioStatus.ACTIVE,
  systemPrompt: '你是试驾邀约助理。',
  greeting: '您好，邀请您到店试驾。',
  knowledgeBaseId: 'kb-presale',
  allowedTools: [],
  escalationRules: [],
  defaultFlowId: 'flow-presale-v1',
};

const publishedFlow: TaskFlow = {
  id: 'flow-presale-v1',
  name: '试驾邀约流程',
  description: '默认试驾邀约流程',
  status: FlowStatus.PUBLISHED,
  version: 3,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  nodes: [],
  edges: [],
};

describe('NewTaskPage main flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime.createBatch.mockResolvedValue({ createdCount: 2, tasks: [] });

    vi.mocked(useScenarios).mockReturnValue({ data: [activeScenario] } as ReturnType<typeof useScenarios>);
    vi.mocked(useTaskFlows).mockReturnValue({ data: [publishedFlow] } as ReturnType<typeof useTaskFlows>);
    vi.mocked(useGlobalConfig).mockReturnValue({ data: null } as unknown as ReturnType<typeof useGlobalConfig>);
    vi.mocked(useTaskMutations).mockReturnValue({
      createBatch: mockRuntime.createBatch,
    } as unknown as ReturnType<typeof useTaskMutations>);
  });

  it('imports a call list and submits a batch outbound task request', async () => {
    const { container } = render(<NewTaskPage />);

    await waitFor(() => {
      const selects = container.querySelectorAll('select');
      expect((selects[0] as HTMLSelectElement).value).toBe('presale');
      expect((selects[1] as HTMLSelectElement).value).toBe('flow-presale-v1');
    });

    fireEvent.change(screen.getByPlaceholderText(/phone,name,scheduledAt/), {
      target: {
        value: [
          'phone,name,scheduledAt,priority,company,product',
          '+8613800138000,张三,2026-07-08 10:30,high,星河汽车,试驾邀约',
          '1001,李四,,low,门店A,续保提醒',
        ].join('\n'),
      },
    });

    const submit = await screen.findByRole('button', { name: '创建 2 个任务' });
    expect(screen.getByText('company: 星河汽车')).toBeTruthy();
    expect(screen.getByText('product: 续保提醒')).toBeTruthy();

    fireEvent.click(submit);

    await waitFor(() => expect(mockRuntime.createBatch).toHaveBeenCalledTimes(1));
    expect(mockRuntime.createBatch).toHaveBeenCalledWith({
      scenario: 'presale',
      scenarioId: 'scenario-presale',
      flowId: 'flow-presale-v1',
      scheduledAt: undefined,
      priority: TaskPriority.NORMAL,
      items: [
        {
          to: '+8613800138000',
          scheduledAt: normalizeDateTime('2026-07-08 10:30'),
          priority: TaskPriority.HIGH,
          variables: {
            customerName: '张三',
            company: '星河汽车',
            product: '试驾邀约',
          },
        },
        {
          to: '1001',
          scheduledAt: undefined,
          priority: TaskPriority.LOW,
          variables: {
            customerName: '李四',
            company: '门店A',
            product: '续保提醒',
          },
        },
      ],
    });
    expect(mockRuntime.toastSuccess).toHaveBeenCalledWith('已创建 2 个外呼任务');
    expect(mockRuntime.routerPush).toHaveBeenCalledWith('/tasks');
  });

  it('keeps submission disabled when the imported call list has no valid rows', () => {
    render(<NewTaskPage />);

    fireEvent.change(screen.getByPlaceholderText(/phone,name,scheduledAt/), {
      target: {
        value: [
          'phone,name,scheduledAt,priority',
          'not-a-phone,张三,2026-07-08 10:30,high',
        ].join('\n'),
      },
    });

    expect(screen.getByText('第 2 行：号码格式不正确')).toBeTruthy();
    expect((screen.getByRole('button', { name: '创建 0 个任务' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockRuntime.createBatch).not.toHaveBeenCalled();
  });
});
