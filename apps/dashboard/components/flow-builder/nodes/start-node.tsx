'use client';

import type { NodeProps } from '@xyflow/react';
import { NodeShell } from './node-shell';

export function StartNode({ id, selected }: NodeProps) {
  return (
    <NodeShell
      type="start"
      id={id}
      selected={selected}
      summary="流程入口"
      isConfigured
    />
  );
}
