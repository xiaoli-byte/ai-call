'use client';

import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { FlowEdge, FlowNode } from '@ai-call/shared';

import { Toolbar } from './toolbar';
import { FlowCanvas } from './flow-canvas';
import { PropertyPanel } from './property-panel';
import { useFlowStorage } from './hooks/use-flow-storage';
import { useFlowStore } from './store/flow-store';

interface FlowBuilderProps {
  flowId: string;
  flowName: string;
  initialNodes: FlowNode[];
  initialEdges: FlowEdge[];
}

export function FlowBuilder({
  flowId,
  flowName,
  initialNodes,
  initialEdges,
}: FlowBuilderProps) {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner
        flowId={flowId}
        flowName={flowName}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
      />
    </ReactFlowProvider>
  );
}

function FlowBuilderInner({
  flowId,
  flowName,
  initialNodes,
  initialEdges,
}: FlowBuilderProps) {
  const setFlow = useFlowStore((s) => s.setFlow);
  const { status, saveNow } = useFlowStorage(flowId);

  useEffect(() => {
    setFlow(initialNodes, initialEdges);
  }, [initialNodes, initialEdges, setFlow]);

  return (
    <>
      <Toolbar flowName={flowName} onSave={saveNow} saveStatus={status} />
      <div className="flex h-full">
        <FlowCanvas />
        <PropertyPanel />
      </div>
    </>
  );
}