import { apiServer } from '@/lib/api/server';
import { Scenario, TaskStatus } from '@ai-call/shared';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待拨打', calling: '拨打中', in_call: '通话中',
  completed: '已完成', failed: '失败', no_answer: '未接听', cancelled: '已取消',
};

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending: 'badge-neutral', calling: 'badge-info', in_call: 'badge-info',
  completed: 'badge-success', failed: 'badge-danger', no_answer: 'badge-warning', cancelled: 'badge-neutral',
};

const SCENARIO_LABELS: Record<Scenario, string> = {
  collection: '贷后催收', ecommerce: '电商售后', presale: '售前邀约',
};

const SCENARIO_BADGE: Record<Scenario, string> = {
  collection: 'badge-warning',
  ecommerce: 'badge-info',
  presale: 'badge-primary',
};

const OUTCOME_LABELS: Record<string, string> = {
  high_intent: '高意向', medium_intent: '中意向', low_intent: '低意向',
  rejected: '已拒绝', unreached: '未触达', escalated: '转人工', error: '异常',
};

const OUTCOME_BADGE: Record<string, string> = {
  high_intent: 'badge-success',
  medium_intent: 'badge-info',
  low_intent: 'badge-neutral',
  rejected: 'badge-danger',
  unreached: 'badge-warning',
  escalated: 'badge-warning',
  error: 'badge-danger',
};

function formatDuration(seconds?: number) {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export default async function CallsPage({ searchParams }: { searchParams: { cursor?: string } }) {
  let page: Awaited<ReturnType<typeof apiServer.listTasks>> = { items: [] };
  let error: string | null = null;
  try {
    page = await apiServer.listTasks({ cursor: searchParams.cursor });
  } catch (e) {
    error = e instanceof Error ? e.message : '加载失败';
  }
  const tasks = page.items;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">通话历史</h1>
          <p className="subtitle">查看所有外呼通话的转写、录音、意向分级</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            导出 CSV
          </button>
        </div>
      </div>

      {error ? (
        <div className="card">
          <div className="empty">
            <div className="empty-title" style={{ color: 'var(--danger)' }}>{error}</div>
            <div className="empty-desc">请先启动后端：<code>cd apps/api && pnpm dev</code></div>
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <div className="card">
          <div className="empty">
            <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l4 2" />
            </svg>
            <div className="empty-title">暂无通话记录</div>
            <div className="empty-desc">开始外呼任务后，通话记录会显示在这里</div>
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
                  <th>通话时长</th>
                  <th>意向</th>
                  <th>转写轮数</th>
                  <th>开始时间</th>
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
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDuration(t.duration)}</td>
                    <td>
                      {t.outcome ? (
                        <span className={`badge ${OUTCOME_BADGE[t.outcome] ?? 'badge-neutral'}`}>
                          {OUTCOME_LABELS[t.outcome] ?? t.outcome}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{t.transcriptCount}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '12.5px' }}>
                      {t.calledAt ? new Date(t.calledAt).toLocaleString('zh-CN', { hour12: false }) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {page.nextCursor && (
        <div className="row-actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <a href={`/calls?cursor=${encodeURIComponent(page.nextCursor)}`} className="btn btn-secondary">下一页</a>
        </div>
      )}
    </div>
  );
}
