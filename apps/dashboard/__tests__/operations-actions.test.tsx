import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserStatus } from '@ai-call/shared';
import { useAuthStore } from '@/lib/auth-store';
import type { IntegrationActions as IntegrationActionsType } from '../app/integrations/IntegrationActions';
import type { HandoffActions as HandoffActionsType } from '../app/handoffs/HandoffActions';
import type { KnowledgeActions as KnowledgeActionsType } from '../app/knowledge/[id]/KnowledgeActions';
import type { ScenarioTestRunner as ScenarioTestRunnerType } from '../app/scenarios/[id]/tests/ScenarioTestRunner';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  integrationsCreate: vi.fn(),
  integrationsTest: vi.fn(),
  handoffsUpdate: vi.fn(),
  handoffsCreateCallbackTask: vi.fn(),
  knowledgeTestRetrieve: vi.fn(),
  scenarioTestsRun: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('@/lib/toast', () => ({
  appToast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    integrations: {
      create: mocks.integrationsCreate,
      test: mocks.integrationsTest,
    },
    handoffs: {
      update: mocks.handoffsUpdate,
      createCallbackTask: mocks.handoffsCreateCallbackTask,
    },
    knowledge: {
      testRetrieve: mocks.knowledgeTestRetrieve,
    },
    scenarioTests: {
      run: mocks.scenarioTestsRun,
    },
  },
}));

let IntegrationActions: typeof IntegrationActionsType;
let HandoffActions: typeof HandoffActionsType;
let KnowledgeActions: typeof KnowledgeActionsType;
let ScenarioTestRunner: typeof ScenarioTestRunnerType;
let previousReactGlobal: typeof React | undefined;
let hadReactGlobal = false;

describe('dashboard operation action components', () => {
  beforeAll(async () => {
    const reactGlobal = globalThis as typeof globalThis & { React?: typeof React };
    hadReactGlobal = 'React' in reactGlobal;
    previousReactGlobal = reactGlobal.React;
    reactGlobal.React = React;
    ({ IntegrationActions } = await import('../app/integrations/IntegrationActions'));
    ({ HandoffActions } = await import('../app/handoffs/HandoffActions'));
    ({ KnowledgeActions } = await import('../app/knowledge/[id]/KnowledgeActions'));
    ({ ScenarioTestRunner } = await import('../app/scenarios/[id]/tests/ScenarioTestRunner'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // 本文件覆盖的写操作按钮分别受 task:update（连接器）/ task:create（回拨任务）/
    // knowledge:create（知识库上传）权限门控，测试用户需具备这些权限码
    useAuthStore.getState().setUser({
      id: 'user-1',
      email: 'operator@example.com',
      name: '测试操作员',
      status: UserStatus.ACTIVE,
      roles: ['operator'],
      permissions: ['task:update', 'task:create', 'knowledge:create'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    const reactGlobal = globalThis as unknown as { React?: typeof React };
    if (hadReactGlobal) {
      reactGlobal.React = previousReactGlobal;
    } else {
      delete reactGlobal.React;
    }
  });

  it('creates the default CRM webhook integration, shows success, and refreshes', async () => {
    mocks.integrationsCreate.mockResolvedValueOnce({ id: 'connector-1' });
    render(<IntegrationActions />);

    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => {
      expect(mocks.integrationsCreate).toHaveBeenCalledWith({
        name: 'CRM Webhook',
        type: 'crm',
        endpoint: 'mock://crm/leads',
        authType: 'none',
        requestTemplate: {
          phone: '{{phone}}',
          customerName: '{{customerName}}',
          intent: '{{intent}}',
        },
        responseMapping: { externalId: '$.id' },
        enabled: true,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('does not test an integration without a connector id and shows an error', () => {
    render(<IntegrationActions />);

    fireEvent.click(screen.getAllByRole('button')[1]);

    expect(mocks.integrationsTest).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it('shows an error and does not refresh when integration creation rejects', async () => {
    const error = new Error('create failed');
    mocks.integrationsCreate.mockRejectedValueOnce(error);
    render(<IntegrationActions />);

    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => {
      expect(mocks.integrationsCreate).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith(error);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('creates a callback task one hour from now, shows success, and refreshes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-07T08:00:00.000Z').getTime());
    mocks.handoffsCreateCallbackTask.mockResolvedValueOnce({ id: 'task-1' });
    render(<HandoffActions id="handoff-1" status="processing" />);

    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => {
      expect(mocks.handoffsCreateCallbackTask).toHaveBeenCalledWith('handoff-1', {
        scheduledAt: '2026-07-07T09:00:00.000Z',
      });
      expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('renders no handoff action buttons for completed tickets', () => {
    render(<HandoffActions id="handoff-1" status="completed" />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('retrieves knowledge test results with the entered query and default topK', async () => {
    mocks.knowledgeTestRetrieve.mockResolvedValueOnce({
      answer: 'Use the billing workflow.',
      lowConfidence: false,
      results: [],
    });
    render(<KnowledgeActions knowledgeBaseId="kb-1" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'How do I update billing?' } });
    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => {
      expect(mocks.knowledgeTestRetrieve).toHaveBeenCalledWith('kb-1', {
        query: 'How do I update billing?',
        topK: 3,
      });
      expect(screen.getByText('Use the billing workflow.')).toBeTruthy();
    });
  });

  it('does not retrieve knowledge with an empty query and shows an error', () => {
    render(<KnowledgeActions knowledgeBaseId="kb-1" />);

    fireEvent.click(screen.getAllByRole('button')[0]);

    expect(mocks.knowledgeTestRetrieve).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it('uploads a selected knowledge file, shows success, and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<KnowledgeActions knowledgeBaseId="kb-1" />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'guide.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getAllByRole('button')[2]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-base/kb-1/upload', {
        method: 'POST',
        credentials: 'include',
        body: expect.any(FormData),
      });
      expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('file')).toBe(file);
  });

  it('does not upload knowledge without a file and shows an error', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<KnowledgeActions knowledgeBaseId="kb-1" />);

    fireEvent.click(screen.getAllByRole('button')[2]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it('shows an error and does not refresh when knowledge upload fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'upload failed',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<KnowledgeActions knowledgeBaseId="kb-1" />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'guide.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getAllByRole('button')[2]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-base/kb-1/upload', {
        method: 'POST',
        credentials: 'include',
        body: expect.any(FormData),
      });
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
    });
    const error = mocks.toastError.mock.calls[0][0] as Error;
    expect(error.message).toBe('upload failed');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('runs a scenario test with input and selected defaults, shows success, and refreshes', async () => {
    mocks.scenarioTestsRun.mockResolvedValueOnce({ id: 'test-1' });
    render(<ScenarioTestRunner scenarioKey="collections" flowOptions={[{ id: 'flow-1', name: 'Collections' }]} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The customer needs more time.' } });
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mocks.scenarioTestsRun).toHaveBeenCalledWith('collections', {
        input: 'The customer needs more time.',
        flowId: 'flow-1',
        expectedOutcome: 'handoff',
        golden: true,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('does not run a scenario test with empty input and shows an error', () => {
    render(<ScenarioTestRunner scenarioKey="collections" flowOptions={[{ id: 'flow-1', name: 'Collections' }]} />);

    fireEvent.click(screen.getByRole('button'));

    expect(mocks.scenarioTestsRun).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});
