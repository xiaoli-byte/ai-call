'use client';

import { FlowBuilder } from '@/components/flow-builder/flow-builder';
import { useTaskFlow } from '@/hooks/use-task-flows';
import type { TaskFlow } from '@ai-call/shared';

export function FlowBuilderClient({ flow }: { flow: TaskFlow }) {
  // 订阅 SWR 缓存：自动保存会把已发布流程降级为草稿并写回缓存，
  // 状态/版本必须响应式更新，否则工具栏拿着过期的 published 把发布按钮锁死。
  const { data: liveFlow } = useTaskFlow(flow.id, flow);
  return (
    <FlowBuilder
      flowId={flow.id}
      flowName={liveFlow?.name ?? flow.name}
      flowVersion={liveFlow?.version ?? flow.version}
      flowStatus={liveFlow?.status ?? flow.status}
      initialNodes={flow.nodes}
      initialEdges={flow.edges}
    />
  );
}
