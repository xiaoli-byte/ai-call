'use client';

import type { NodeProps } from '@xyflow/react';
import type { EndNodeData } from '@ai-call/shared';
import { NodeShell } from './node-shell';

const MODE_LABELS: Record<EndNodeData['mode'], string> = {
  complete: '正常结束',
  hangup: '挂机',
};

function getSummary(data: EndNodeData): string {
  if (data.farewell) return data.farewell.slice(0, 40);
  if (data.reason) return data.reason;
  return '';
}

function isConfigured(data: EndNodeData): boolean {
  return !!data.farewell || !!data.reason;
}

export function EndNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as EndNodeData;
  return (
    <NodeShell
      type="end"
      id={id}
      selected={selected}
      summary={getSummary(nodeData)}
      isConfigured={isConfigured(nodeData)}
      modeLabel={MODE_LABELS[nodeData.mode]}
    />
  );
}
