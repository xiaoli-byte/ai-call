'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReactFlowProvider } from '@xyflow/react';
import type { FlowEdge, FlowNode, FlowStatus } from '@ai-call/shared';
import { useTaskFlowMutations } from '@/hooks/use-task-flows';
import { appToast } from '@/lib/toast';

import { Toolbar } from './toolbar';
import { FlowCanvas } from './flow-canvas';
import { PropertyPanel } from './property-panel';
import { FlowDebugPanel } from './flow-debug-panel';
import { useFlowStorage } from './hooks/use-flow-storage';
import { useFlowStore } from './store/flow-store';
import styles from './flow-builder.module.scss';

interface FlowBuilderProps {
  flowId: string;
  flowName: string;
  flowVersion?: number;
  flowStatus?: FlowStatus;
  initialNodes: FlowNode[];
  initialEdges: FlowEdge[];
}

export function FlowBuilder({
  flowId,
  flowName,
  flowVersion,
  flowStatus,
  initialNodes,
  initialEdges,
}: FlowBuilderProps) {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner
        flowId={flowId}
        flowName={flowName}
        flowVersion={flowVersion}
        flowStatus={flowStatus}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
      />
    </ReactFlowProvider>
  );
}

function FlowBuilderInner({
  flowId,
  flowName,
  flowVersion,
  flowStatus,
  initialNodes,
  initialEdges,
}: FlowBuilderProps) {
  const router = useRouter();
  const setFlow = useFlowStore((s) => s.setFlow);
  const { status, saveNow } = useFlowStorage(flowId);
  const { publish } = useTaskFlowMutations();

  const [publishError, setPublishError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  useEffect(() => {
    setFlow(initialNodes, initialEdges);
  }, [initialNodes, initialEdges, setFlow]);

  async function handlePublish() {
    setPublishError(null);
    try {
      await saveNow();
      await publish(flowId);
      appToast.success('流程已发布');
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '发布失败';
      setPublishError(msg);
      appToast.error(e);
    }
  }

  return (
    <div className={styles.flowEditorShell}>
      <Toolbar
        flowName={flowName}
        flowVersion={flowVersion}
        flowStatus={flowStatus}
        onSave={saveNow}
        saveStatus={status}
        onPublish={handlePublish}
        onTest={() => setDebugOpen(true)}
      />
      {publishError && (
        <div className="error-banner" style={{ margin: 0, borderRadius: 0 }}>
          发布失败：{publishError}
        </div>
      )}
      <div className={styles.flowEditorMain}>
        <FlowCanvas />
        <PropertyPanel />
        <FlowDebugPanel
          flowId={flowId}
          flowName={flowName}
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          onSaveFlow={saveNow}
        />
      </div>
    </div>
  );
}
