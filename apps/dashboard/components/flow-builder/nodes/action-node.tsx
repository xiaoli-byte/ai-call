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
  const config = (data.config ?? {}) as Record<string, unknown>;
  if (data.actionType === 'transfer' && config.extension) {
    return `转分机 ${config.extension}`;
  }
  if (data.actionType === 'sms' && config.template) {
    return `模板: ${config.template}`;
  }
  if (data.actionType === 'crm' && config.action) {
    return `CRM: ${config.action}`;
  }
  if (data.actionType === 'api' && config.pluginName) {
    return `插件: ${config.pluginName}`;
  }
  if (data.actionType === 'api' && config.url) {
    return String(config.url).slice(0, 40);
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
