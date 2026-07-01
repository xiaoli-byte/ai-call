'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReactFlowProvider } from '@xyflow/react';
import type { FlowEdge, FlowNode, FlowStatus } from '@ai-call/shared';
import { apiClient } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

import { Toolbar } from './toolbar';
import { FlowCanvas } from './flow-canvas';
import { PropertyPanel } from './property-panel';
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

  const [publishError, setPublishError] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    setFlow(initialNodes, initialEdges);
  }, [initialNodes, initialEdges, setFlow]);

  async function handlePublish() {
    setPublishError(null);
    try {
      await saveNow();
      await apiClient.taskFlows.publish(flowId);
      router.refresh();
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : '发布失败');
    }
  }

  async function handleTestSubmit() {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await apiClient.taskFlows.test(flowId, testInput);
      setTestResult(res.reply);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : '测试失败');
    } finally {
      setTesting(false);
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
        onTest={() => {
          setTestResult(null);
          setTestError(null);
          setTestInput('');
          setTestOpen(true);
        }}
      />
      {publishError && (
        <div className="error-banner" style={{ margin: 0, borderRadius: 0 }}>
          发布失败：{publishError}
        </div>
      )}
      <div className={styles.flowEditorMain}>
        <FlowCanvas />
        <PropertyPanel />
      </div>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>测试 AI 对话</DialogTitle>
            <DialogDescription>
              输入文本，将调用流程中首个 AI 对话节点的 systemPrompt 生成回复。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              className="form-input"
              rows={3}
              placeholder="例如：你好，我想咨询一下"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              disabled={testing}
            />
            {testResult !== null && (
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {testResult || '（空回复）'}
              </div>
            )}
            {testError && (
              <div className="error-banner" style={{ margin: 0 }}>
                {testError}
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setTestOpen(false)}
              disabled={testing}
            >
              关闭
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleTestSubmit}
              disabled={testing || !testInput.trim()}
            >
              {testing ? '调用中…' : '生成回复'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
