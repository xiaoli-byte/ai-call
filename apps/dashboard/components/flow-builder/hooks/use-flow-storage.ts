'use client';

import { useEffect, useRef, useState } from 'react';
import { useFlowStore } from '../store/flow-store';
import { apiClient } from '@/lib/api';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * 自动保存 Hook
 *
 * debounce 2s 自动保存 + 手动 saveNow。
 * 跳过空状态（nodes 和 edges 都为空时不保存）。
 */
export function useFlowStorage(flowId: string) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const firstLoadRef = useRef(true);

  useEffect(() => {
    // 首次加载（setFlow 触发）不保存
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      return;
    }
    // 跳过空状态
    if (nodes.length === 0) return;

    setStatus('saving');
    const timer = setTimeout(async () => {
      try {
        await apiClient.taskFlows.update(flowId, { nodes, edges });
        setStatus('saved');
      } catch (err) {
        console.error('Auto-save failed:', err);
        setStatus('error');
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [nodes, edges, flowId]);

  const saveNow = async () => {
    setStatus('saving');
    try {
      await apiClient.taskFlows.update(flowId, { nodes, edges });
      setStatus('saved');
    } catch (err) {
      console.error('Save failed:', err);
      setStatus('error');
    }
  };

  return { status, saveNow };
}
