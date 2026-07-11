'use client';

import type { NodeProps } from '@xyflow/react';
import type { DialogNodeData } from '@ai-call/shared';
import { NodeShell } from './node-shell';

const MODE_LABELS: Record<DialogNodeData['mode'], string> = {
  script: '固定话术',
  question: '固定话术',
  ai: 'AI 生成',
};

function getSummary(data: DialogNodeData): string {
  if (data.mode === 'script' && data.text) return data.text.slice(0, 40);
  if (data.mode === 'question' && data.prompt) return data.prompt.slice(0, 40);
  if (data.mode === 'ai' && data.prompt) return data.prompt.slice(0, 40);
  if (data.mode === 'ai' && data.systemPrompt)
    return data.systemPrompt.slice(0, 40);
  return '';
}

function isConfigured(data: DialogNodeData): boolean {
  if (data.mode === 'script') return !!data.text;
  if (data.mode === 'question') return !!data.prompt;
  if (data.mode === 'ai') return !!data.systemPrompt;
  return false;
}

export function DialogNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as DialogNodeData;
  return (
    <NodeShell
      type="dialog"
      id={id}
      selected={selected}
      summary={getSummary(nodeData)}
      isConfigured={isConfigured(nodeData)}
      modeLabel={MODE_LABELS[nodeData.mode]}
    />
  );
}
