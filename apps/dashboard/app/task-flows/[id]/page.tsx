'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api';
import type { TaskFlow } from '@ai-call/shared';
import { FlowBuilderClient } from './FlowBuilderClient';

export default function FlowEditorPage() {
  const params = useParams<{ id: string }>();
  const [flow, setFlow] = useState<TaskFlow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    apiClient.taskFlows
      .get(params.id)
      .then(setFlow)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [params?.id]);

  if (error) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-title" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
          <div className="empty-desc">
            请先启动后端：<code>cd apps/api && pnpm dev</code>
          </div>
        </div>
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-title">加载中...</div>
        </div>
      </div>
    );
  }

  return <FlowBuilderClient flow={flow} />;
}