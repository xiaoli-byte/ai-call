'use client';

import type { NodeProps } from '@xyflow/react';
import type { ActionNodeData } from '@ai-call/shared';
import { NodeShell } from './node-shell';

const ACTION_LABELS: Record<ActionNodeData['actionType'], string> = {
  transfer: '转人工',
  sms: '发短信',
  crm: 'CRM',
  api: 'API',
};

function getSummary(data: ActionNodeData): string {
  if (data.actionType === 'transfer' && data.config?.extension) {
    return `转分机 ${data.config.extension}`;
  }
  if (data.actionType === 'sms' && data.config?.template) {
    return `模板: ${data.config.template}`;
  }
  if (data.actionType === 'crm' && data.config?.action) {
    return `CRM: ${data.config.action}`;
  }
  if (data.actionType === 'api' && data.config?.url) {
    return String(data.config.url).slice(0, 40);
  }
  return '';
}

function isConfigured(data: ActionNodeData): boolean {
  return Object.keys(data.config ?? {}).length > 0;
}

export function ActionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ActionNodeData;
  return (
    <NodeShell
      type="action"
      id={id}
      selected={selected}
      summary={getSummary(nodeData)}
      isConfigured={isConfigured(nodeData)}
      modeLabel={ACTION_LABELS[nodeData.actionType]}
    />
  );
}
