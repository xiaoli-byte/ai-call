'use client';

import { FlowBuilder } from '@/components/flow-builder/flow-builder';
import type { TaskFlow } from '@ai-call/shared';

export function FlowBuilderClient({ flow }: { flow: TaskFlow }) {
  return (
    <FlowBuilder
      flowId={flow.id}
      flowName={flow.name}
      flowVersion={flow.version}
      flowStatus={flow.status}
      initialNodes={flow.nodes}
      initialEdges={flow.edges}
    />
  );
}
