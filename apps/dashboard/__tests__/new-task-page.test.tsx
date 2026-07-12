import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenarioStatus } from '@ai-call/shared';

const mocks = vi.hoisted(() => ({
  createBatch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  flows: [] as Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    version: number;
    nodes: Array<{ data: Record<string, unknown> }>;
    edges: unknown[];
    createdAt: string;
    updatedAt: string;
  }>,
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
  useTaskFlows: () => ({ data: mocks.flows }),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: { tasks: { createBatch: mocks.createBatch } },
}));

vi.mock('@/lib/toast', () => ({
  appToast: { success: mocks.success, error: vi.fn() },
}));

import NewTaskPage from '../app/tasks/new/page';

async function captureDownloadTemplateCsv(): Promise<string> {
  const blobParts: BlobPart[][] = [];
  const originalBlob = globalThis.Blob;
  const MockBlob = vi.fn((parts?: BlobPart[]) => {
    blobParts.push(parts ?? []);
    return { text: () => Promise.resolve((parts ?? []).map((p) => String(p)).join('')) };
  }) as unknown as typeof Blob;
  globalThis.Blob = MockBlob;

  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn(() => {});

  const clickSpy = vi.fn();
  const anchorSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy);

  const button = screen.getByRole('button', { name: /下载模板/ });
  fireEvent.click(button);

  await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

  const parts = blobParts[0] ?? [];
  const csv = parts.map((p) => String(p)).join('');

  anchorSpy.mockRestore();
  globalThis.Blob = originalBlob;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  return csv;
}

describe('NewTaskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBatch.mockResolvedValue({ createdCount: 1, tasks: [] });
    mocks.flows = [];
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

  it('download template falls back to phone,name,company when no flow is selected', async () => {
    render(<NewTaskPage />);
    const csv = await captureDownloadTemplateCsv();
    const lines = csv.split('\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('\ufeffphone,name,company');
  });

  it('download template includes dynamic columns from selected flow variables', async () => {
    mocks.flows = [{
      id: 'flow-1',
      name: '试驾邀约',
      description: '',
      status: 'published',
      version: 1,
      nodes: [
        { data: { text: '您好${name},我是${company}的${agentName}' } },
        { data: { text: '请确认${orderId}', prompt: '${productName}' } },
        { data: { farewell: '感谢${customerName}参与${campaignName}' } },
      ],
      edges: [],
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    }];

    render(<NewTaskPage />);

    const flowSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(flowSelect, { target: { value: 'flow-1' } });

    const csv = await captureDownloadTemplateCsv();
    const lines = csv.split('\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('\ufeffphone,name,company,agentName,orderId,productName,campaignName');
    expect(lines[1]).toBe('1001,张三,示例公司,,,,');
  });
});
