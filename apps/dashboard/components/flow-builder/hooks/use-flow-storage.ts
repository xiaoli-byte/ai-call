'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlowEdge, FlowNode } from '@ai-call/shared';
import { useFlowStore } from '../store/flow-store';
import { useTaskFlowMutations } from '@/hooks/use-task-flows';
import { appToast } from '@/lib/toast';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface PersistedFlow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = normalizeJsonValue(
        (value as Record<string, unknown>)[key],
      );
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
    return result;
  }

  return value;
}

function toPersistedFlow(nodes: FlowNode[], edges: FlowEdge[]): PersistedFlow {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      data: normalizeJsonValue(node.data) as FlowNode['data'],
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.label !== undefined ? { label: edge.label } : {}),
      ...(edge.sourceHandle !== undefined
        ? { sourceHandle: edge.sourceHandle }
        : {}),
      ...(edge.targetHandle !== undefined
        ? { targetHandle: edge.targetHandle }
        : {}),
    })),
  };
}

function flowSignature(flow: PersistedFlow): string {
  return JSON.stringify(flow);
}

/**
 * 自动保存 Hook
 *
 * debounce 2s 自动保存 + 手动 saveNow。
 * 跳过空状态（nodes 和 edges 都为空时不保存）。
 */
export function useFlowStorage(
  flowId: string,
  initialNodes: FlowNode[] = [],
  initialEdges: FlowEdge[] = [],
) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const { update } = useTaskFlowMutations();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const updateRef = useRef(update);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSignature = useMemo(
    () => flowSignature(toPersistedFlow(initialNodes, initialEdges)),
    [initialNodes, initialEdges],
  );
  const lastSavedSignatureRef = useRef(initialSignature);
  const persistedFlow = useMemo(
    () => toPersistedFlow(nodes, edges),
    [nodes, edges],
  );
  const currentSignature = useMemo(
    () => flowSignature(persistedFlow),
    [persistedFlow],
  );

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    lastSavedSignatureRef.current = initialSignature;
    setStatus('idle');
  }, [flowId, initialSignature]);

  useEffect(() => {
    // 跳过空状态
    if (nodes.length === 0) return;
    if (currentSignature === lastSavedSignatureRef.current) {
      setStatus((prev) => (prev === 'saving' ? 'saved' : prev));
      return;
    }

    setStatus('saving');
    const timer = setTimeout(async () => {
      try {
        await updateRef.current(flowId, persistedFlow);
        lastSavedSignatureRef.current = currentSignature;
        setStatus('saved');
      } catch (err) {
        console.error('Auto-save failed:', err);
        setStatus('error');
      } finally {
        if (autoSaveTimerRef.current === timer) {
          autoSaveTimerRef.current = null;
        }
      }
    }, 2000);
    autoSaveTimerRef.current = timer;

    return () => {
      clearTimeout(timer);
      if (autoSaveTimerRef.current === timer) {
        autoSaveTimerRef.current = null;
      }
    };
  }, [nodes.length, persistedFlow, currentSignature, flowId]);

  const saveNow = async () => {
    if (nodes.length === 0) return;
    if (currentSignature === lastSavedSignatureRef.current) {
      setStatus('saved');
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    setStatus('saving');
    try {
      await updateRef.current(flowId, persistedFlow);
      lastSavedSignatureRef.current = currentSignature;
      setStatus('saved');
    } catch (err) {
      console.error('Save failed:', err);
      appToast.error(err);
      setStatus('error');
    }
  };

  return { status, saveNow };
}
