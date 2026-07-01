import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { Scenario, TaskStatus, CallOutcome } from '@ai-call/shared';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待拨打',
  calling: '拨打中',
  in_call: '通话中',
  completed: '已完成',
  failed: '失败',
  no_answer: '未接听',
  cancelled: '已取消',
};

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending: 'badge-neutral',
  calling: 'badge-info',
  in_call: 'badge-info',
  completed: 'badge-success',
  failed: 'badge-danger',
  no_answer: 'badge-warning',
  cancelled: 'badge-neutral',
};

const SCENARIO_LABELS: Record<Scenario, string> = {
  collection: '贷后催收',
  ecommerce: '电商售后',
  presale: '售前邀约',
};

const SCENARIO_BADGE: Record<Scenario, string> = {
  collection: 'badge-warning',
  ecommerce: 'badge-info',
  presale: 'badge-primary',
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { scenario?: Scenario; status?: TaskStatus; cursor?: string };
}) {
  let page: Awaited<ReturnType<typeof apiClient.listTasks>> = { items: [] };
  let error: string | null = null;
  try {
    page = await apiClient.listTasks(searchParams);
  } catch (e) {
    error = e instanceof Error ? e.message : '加载失败';
  }
  const tasks = page.items;
  const nextHref = page.nextCursor
    ? `/tasks?${new URLSearchParams({
        ...(searchParams.scenario ? { scenario: searchParams.scenario } : {}),
        ...(searchParams.status ? { status: searchParams.status } : {}),
        cursor: page.nextCursor,
      }).toString()}`
    : undefined;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">外呼任务</h1>
          <p className="subtitle">创建、派发、跟踪外呼任务</p>
        </div>
        <div className="page-actions">
          <Link href="/tasks/new" className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建任务
          </Link>
        </div>
      </div>

      <form className="filter-bar">
        <select name="scenario" className="form-select" defaultValue={searchParams.scenario ?? ''}>
          <option value="">全部场景</option>
          <option value="collection">贷后催收</option>
          <option value="ecommerce">电商售后</option>
          <option value="presale">售前邀约</option>
        </select>
        <select name="status" className="form-select" defaultValue={searchParams.status ?? ''}>
          <option value="">全部状态</option>
          <option value="pending">待拨打</option>
          <option value="calling">拨打中</option>
          <option value="in_call">通话中</option>
          <option value="completed">已完成</option>
          <option value="no_answer">未接听</option>
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">应用筛选</button>
        <Link href="/tasks" className="btn btn-ghost btn-sm">重置</Link>
      </form>

      {error ? (
        <div className="card">
          <div className="empty">
            <div className="empty-title" style={{ color: 'var(--danger)' }}>后端连接失败</div>
            <div className="empty-desc">{error}</div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
              请先启动后端：<code>cd apps/api && pnpm dev</code>
            </div>
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <div className="card">
          <div className="empty">
            <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <div className="empty-title">暂无外呼任务</div>
            <div className="empty-desc">创建第一个外呼任务开始使用</div>
            <Link href="/tasks/new" className="btn">创建第一个任务</Link>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>任务 ID</th>
                  <th>被叫号码</th>
                  <th>场景</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="table-mono">{t.id.slice(0, 8)}…</td>
                    <td style={{ fontWeight: 500 }}>{t.to}</td>
                    <td>
                      <span className={`badge ${SCENARIO_BADGE[t.scenario]}`}>
                        {SCENARIO_LABELS[t.scenario]}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-dot ${STATUS_BADGE[t.status]}`}>
                        {STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '12.5px' }}>
                      {new Date(t.createdAt).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td>
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        {t.status === 'pending' && (
                          <form action={`/api/tasks/${t.id}/dispatch`} method="POST">
                            <button type="submit" className="btn btn-sm">派发</button>
                          </form>
                        )}
                        <Link href={`/calls/${t.id}`} className="btn btn-secondary btn-sm">详情</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {nextHref && (
        <div className="row-actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <Link href={nextHref} className="btn btn-secondary">下一页</Link>
        </div>
      )}
    </div>
  );
}
