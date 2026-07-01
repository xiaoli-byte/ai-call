import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { FlowStatus } from '@ai-call/shared';
import { FlowRowActions } from './FlowRowActions';

const STATUS_LABELS: Record<FlowStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

const STATUS_BADGE: Record<FlowStatus, string> = {
  draft: 'badge-neutral',
  published: 'badge-success',
  archived: 'badge-warning',
};

export default async function TaskFlowsPage() {
  let flows: Awaited<ReturnType<typeof apiClient.taskFlows.list>> = [];
  let error: string | null = null;
  try {
    flows = await apiClient.taskFlows.list();
  } catch (e) {
    error = e instanceof Error ? e.message : '加载失败';
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">外呼流程</h1>
          <p className="subtitle">可视化编排外呼话术与动作流程</p>
        </div>
        <div className="page-actions">
          <Link href="/task-flows/new" className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建流程
          </Link>
        </div>
      </div>

      {error ? (
        <div className="card">
          <div className="empty">
            <div className="empty-title" style={{ color: 'var(--danger)' }}>后端连接失败：{error}</div>
            <div className="empty-desc">请先启动后端：<code>cd apps/api && pnpm dev</code></div>
          </div>
        </div>
      ) : flows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="15" y="15" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
              <path d="M6 9v3a3 3 0 0 0 3 3" />
              <path d="M15 12h-3a3 3 0 0 0-3 3" />
            </svg>
            <div className="empty-title">暂无流程配置</div>
            <div className="empty-desc">创建第一个可视化外呼流程</div>
            <Link href="/task-flows/new" className="btn">创建第一个流程</Link>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>状态</th>
                  <th>版本</th>
                  <th>节点数</th>
                  <th>更新时间</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {flows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/task-flows/${f.id}`} className="link-primary">
                        {f.name}
                      </Link>
                      {f.description && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginTop: 2 }}>
                          {f.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-dot ${STATUS_BADGE[f.status]}`}>
                        {STATUS_LABELS[f.status]}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      v{f.version}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {f.nodes.length}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '12.5px' }}>
                      {new Date(f.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td>
                      <FlowRowActions id={f.id} status={f.status} name={f.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}