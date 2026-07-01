'use client';

import type { NodeProps } from '@xyflow/react';
import type { DecisionNodeData } from '@ai-call/shared';
import { NodeShell } from './node-shell';

const MODE_LABELS: Record<DecisionNodeData['mode'], string> = {
  condition: '条件',
  intent: '意图',
};

function getSummary(data: DecisionNodeData): string {
  if (data.mode === 'condition' && data.expression) return data.expression;
  if (data.mode === 'intent' && data.intents && data.intents.length > 0) {
    return data.intents.slice(0, 3).join(' / ');
  }
  return '';
}

function isConfigured(data: DecisionNodeData): boolean {
  if (data.mode === 'condition') return !!data.expression;
  if (data.mode === 'intent') return !!data.intents && data.intents.length > 0;
  return false;
}

export function DecisionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as DecisionNodeData;
  return (
    <NodeShell
      type="decision"
      id={id}
      selected={selected}
      summary={getSummary(nodeData)}
      isConfigured={isConfigured(nodeData)}
      modeLabel={MODE_LABELS[nodeData.mode]}
    />
  );
}
