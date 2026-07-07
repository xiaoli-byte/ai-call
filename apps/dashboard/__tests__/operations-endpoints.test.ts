import { describe, expect, it } from 'vitest';
import type { HttpAdapter, RequestOptions } from '../lib/api/types';
import { integrationsEndpoints } from '../lib/api/endpoints/integrations';
import { handoffsEndpoints } from '../lib/api/endpoints/handoffs';
import { scenarioTestsEndpoints } from '../lib/api/endpoints/scenario-tests';
import type {
  CreateCallbackTaskDto,
  CreateIntegrationConnectorDto,
  RunScenarioTestDto,
  TestIntegrationConnectorDto,
  UpdateHandoffTicketDto,
} from '@ai-call/shared';

type CapturedRequest = {
  path: string;
  options?: RequestOptions;
};

function captureAdapter() {
  const requests: CapturedRequest[] = [];
  const adapter: HttpAdapter = {
    async request<T>(path: string, options?: RequestOptions): Promise<T> {
      requests.push({ path, options });
      return { id: 'response-1' } as T;
    },
  };

  return { adapter, requests };
}

describe('operations API endpoint contracts', () => {
  it('captures integrations create, test, and logs request contracts', async () => {
    const { adapter, requests } = captureAdapter();
    const endpoints = integrationsEndpoints(adapter);
    const createBody = {
      name: 'CRM connector',
      type: 'crm' as const,
      endpoint: 'https://crm.example.test/webhook',
      authType: 'bearer' as const,
      requestTemplate: { phone: '{{phoneNumber}}' },
      enabled: true,
    } satisfies CreateIntegrationConnectorDto;
    const testBody = {
      sampleVariables: { phoneNumber: '+15550101' },
      sourceTaskId: 'task-1',
    } satisfies TestIntegrationConnectorDto;

    await endpoints.create(createBody);
    await endpoints.test('connector-1', testBody);
    await endpoints.logs({ connectorId: 'connector-1', limit: 50, cursor: 'log-1' });

    expect(requests).toEqual([
      {
        path: '/integrations',
        options: { method: 'POST', body: createBody },
      },
      {
        path: '/integrations/connector-1/test',
        options: { method: 'POST', body: testBody },
      },
      {
        path: '/integrations/logs?connectorId=connector-1&limit=50&cursor=log-1',
        options: undefined,
      },
    ]);
  });

  it('captures handoffs list, update, callback, and analysis request contracts', async () => {
    const { adapter, requests } = captureAdapter();
    const endpoints = handoffsEndpoints(adapter);
    const updateBody = {
      status: 'processing' as const,
      disposition: 'callback_required' as const,
      notes: 'Customer requested a callback.',
      assignedTo: 'agent-1',
    } satisfies UpdateHandoffTicketDto;
    const callbackBody = {
      scheduledAt: '2026-07-08T12:00:00.000Z',
      assignedTo: 'agent-1',
    } satisfies CreateCallbackTaskDto;

    await endpoints.list({
      status: 'pending',
      campaignId: 'campaign-1',
      limit: 25,
      cursor: 'handoff-1',
    });
    await endpoints.update('handoff-1', updateBody);
    await endpoints.createCallbackTask('handoff-1', callbackBody);
    await endpoints.createFromAnalysis('analysis-1');

    expect(requests).toEqual([
      {
        path: '/handoffs?status=pending&campaignId=campaign-1&limit=25&cursor=handoff-1',
        options: undefined,
      },
      {
        path: '/handoffs/handoff-1',
        options: { method: 'PATCH', body: updateBody },
      },
      {
        path: '/handoffs/handoff-1/callback-task',
        options: { method: 'POST', body: callbackBody },
      },
      {
        path: '/handoffs/from-analysis/analysis-1',
        options: { method: 'POST' },
      },
    ]);
  });

  it('captures scenario test list and run request contracts', async () => {
    const { adapter, requests } = captureAdapter();
    const endpoints = scenarioTestsEndpoints(adapter);
    const runBody = {
      flowId: 'flow-1',
      input: 'Ask about pricing',
      expectedOutcome: 'Lead is qualified',
      golden: true,
    } satisfies RunScenarioTestDto;

    await endpoints.list('sales-qualification');
    await endpoints.run('sales-qualification', runBody);

    expect(requests).toEqual([
      {
        path: '/scenarios/sales-qualification/tests',
        options: undefined,
      },
      {
        path: '/scenarios/sales-qualification/tests/run',
        options: { method: 'POST', body: runBody },
      },
    ]);
  });
});
