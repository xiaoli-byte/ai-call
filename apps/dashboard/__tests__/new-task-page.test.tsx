import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenarioStatus } from '@ai-call/shared';

const mocks = vi.hoisted(() => ({
  createBatch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('@/hooks/use-scenarios', () => ({
  useScenarios: () => ({
    data: [{
      id: 'scenario-1',
      scenario: 'presale',
      name: '售前咨询',
      status: ScenarioStatus.ACTIVE,
    }],
  }),
}));

vi.mock('@/hooks/use-task-flows', () => ({
  useTaskFlows: () => ({ data: [] }),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: { tasks: { createBatch: mocks.createBatch } },
}));

vi.mock('@/lib/toast', () => ({
  appToast: { success: mocks.success, error: vi.fn() },
}));

import NewTaskPage from '../app/tasks/new/page';

describe('NewTaskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBatch.mockResolvedValue({ createdCount: 1, tasks: [] });
  });

  it('creates batch tasks directly without creating an activity', async () => {
    render(<NewTaskPage />);

    const file = new File(['phone,name\n13800138000,张三'], 'tasks.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', {
      value: vi.fn().mockResolvedValue('phone,name\n13800138000,张三'),
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    const submit = await screen.findByRole('button', { name: '创建 1 个任务' });
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.createBatch).toHaveBeenCalledTimes(1));
    expect(mocks.createBatch).toHaveBeenCalledWith(expect.objectContaining({
      scenario: 'presale',
      scenarioId: 'scenario-1',
      items: [expect.objectContaining({
        to: '13800138000',
        variables: expect.objectContaining({ customerName: '张三' }),
      })],
    }));
    expect(mocks.push).toHaveBeenCalledWith('/tasks');
  });
});
