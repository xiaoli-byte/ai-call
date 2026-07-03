import { apiServer } from '@/lib/api/server';
import type { TaskFlow } from '@ai-call/shared';
import { FlowBuilderClient } from './FlowBuilderClient';

export default async function FlowEditorPage({
  params,
}: {
  params: { id: string };
}) {
  let flow: TaskFlow | null = null;
  let error: string | null = null;
  try {
    flow = await apiServer.taskFlows.get(params.id);
  } catch (e) {
    error = e instanceof Error ? e.message : '加载失败';
  }

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
