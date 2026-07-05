'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  Headphones,
  Pause,
  PhoneCall,
  Radio,
  XCircle,
} from 'lucide-react';
import { TaskStatus, type OutboundTask } from '@ai-call/shared';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待拨打',
  calling: '拨打中',
  in_call: '通话中',
  completed: '已接通',
  failed: '呼叫失败',
  no_answer: '未接听',
  cancelled: '已暂停',
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  pending: 'is-pending',
  calling: 'is-running',
  in_call: 'is-running',
  completed: 'is-completed',
  failed: 'is-failed',
  no_answer: 'is-paused',
  cancelled: 'is-paused',
};

type DetailFilter = 'all' | TaskStatus;

const DETAIL_FILTERS: Array<{ label: string; value: DetailFilter }> = [
  { label: '全部', value: 'all' },
  { label: '待拨打', value: TaskStatus.PENDING },
  { label: '拨打中', value: TaskStatus.CALLING },
  { label: '通话中', value: TaskStatus.IN_CALL },
  { label: '已接通', value: TaskStatus.COMPLETED },
  { label: '未接听', value: TaskStatus.NO_ANSWER },
  { label: '失败', value: TaskStatus.FAILED },
];

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function formatDuration(seconds?: number) {
  if (!seconds) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : `0:${String(rest).padStart(2, '0')}`;
}

export function TaskDetailView({
  task,
  scenarioName,
  children,
}: {
  task: OutboundTask;
  scenarioName: string;
  children?: ReactNode;
}) {
  const [filter, setFilter] = useState<DetailFilter>('all');
  const attempts = task.attempts ?? [];
  const filteredAttempts = useMemo(
    () => (filter === 'all' ? attempts : attempts.filter((item) => item.status === filter)),
    [attempts, filter],
  );
  const connected = attempts.filter((item) => item.status === 'completed' || item.status === 'in_call').length;
  const running = attempts.filter((item) => item.status === 'calling' || item.status === 'in_call').length;
  const failed = attempts.filter((item) => item.status === 'failed' || item.status === 'no_answer').length;
  const finished = connected + failed;
  const total = Math.max(task.attemptCount, attempts.length, 1);
  const durations = attempts.map((item) => item.duration ?? 0).filter(Boolean);
  const averageDuration = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : 0;
  const customerName = task.variables.customerName || task.variables.name || '外呼客户';

  return (
    <div className="outbound-page outbound-detail-page">
      <header className="outbound-detail-header">
        <Link href="/tasks" className="outbound-back"><ArrowLeft size={14} />返回外呼任务</Link>
        <div className="outbound-detail-title-row">
          <div>
            <div className="outbound-title-with-status">
              <h1>{scenarioName}外呼任务</h1>
              <span className={`outbound-status ${STATUS_CLASS[task.status]}`}><i />{STATUS_LABELS[task.status]}</span>
            </div>
            <p><code>{task.id}</code><span><PhoneCall size={12} />{scenarioName}</span><span><Clock3 size={12} />{formatDate(task.createdAt)}</span></p>
          </div>
          <div className="outbound-header-actions">
            <button type="button" className="warning"><Pause size={14} />暂停任务</button>
            <button type="button"><Download size={14} />导出任务</button>
          </div>
        </div>
      </header>

      <main className="outbound-content outbound-detail-content">
        <section className="outbound-detail-stats">
          <article><span>总外呼量</span><strong>{total.toLocaleString('zh-CN')}</strong><small>预计共 {total.toLocaleString('zh-CN')} 通</small></article>
          <article className="green"><span>已接通</span><strong>{connected}</strong><small><CheckCircle2 size={12} />成功接通</small></article>
          <article className="blue"><span>进行中</span><strong>{running}</strong><small><Radio size={12} />实时执行中</small></article>
          <article className="orange"><span>未接听 / 失败</span><strong>{failed}</strong><small><XCircle size={12} />需后续处理</small></article>
          <article><span>平均通话时长</span><strong>{formatDuration(averageDuration)}</strong><small>实时均值</small></article>
        </section>

        <section className="outbound-progress-card">
          <div><strong>任务进度</strong><span>{finished} / {total} 已处理</span></div>
          <div className="outbound-progress-track"><i className="done" style={{ width: `${Math.min((connected / total) * 100, 100)}%` }} /><i className="failed" style={{ width: `${Math.min((failed / total) * 100, 100)}%` }} /></div>
          <p><span className="green-dot">已接通 {connected}</span><span className="red-dot">失败 {failed}</span><span>待处理 {Math.max(total - finished, 0)}</span></p>
        </section>

        <section className="outbound-records">
          <div className="outbound-section-heading">
            <h2>外呼记录明细</h2>
            <div className="outbound-segments compact" role="tablist" aria-label="外呼记录状态">
              {DETAIL_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={filter === item.value ? 'active' : ''}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="outbound-table-shell">
            <div className="outbound-table-scroll">
              <table className="outbound-table outbound-record-table">
                <thead><tr><th>客户信息</th><th>呼叫状态</th><th>呼叫时间</th><th className="numeric">通话时长</th><th>意图识别</th><th>外呼结果</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {filteredAttempts.length ? filteredAttempts.map((attempt) => (
                    <tr key={attempt.id} className="outbound-record-row">
                      <td><Link className="outbound-customer" href={`/tasks/${task.id}/calls/${attempt.id}`}><strong>{customerName}</strong><span>{task.to}</span></Link></td>
                      <td><span className={`outbound-status ${STATUS_CLASS[attempt.status]}`}><i />{STATUS_LABELS[attempt.status]}</span></td>
                      <td className="mono">{formatDate(attempt.startedAt)}</td>
                      <td className="numeric mono">{formatDuration(attempt.duration)}</td>
                      <td>{task.intentTags?.length ? <span className="outbound-intent">{task.intentTags[0]}</span> : <span className="muted">—</span>}</td>
                      <td className="outbound-result">{attempt.hangupCause || (attempt.status === 'completed' ? '通话已完成' : STATUS_LABELS[attempt.status])}</td>
                      <td>
                        <Link href={`/tasks/${task.id}/calls/${attempt.id}`} className="outbound-row-action">
                          <Eye size={12} />
                          查看对话
                        </Link>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={7}><div className="outbound-empty compact"><Headphones size={20} /><strong>{attempts.length ? '当前筛选暂无记录' : '暂无外呼记录'}</strong><span>{attempts.length ? '切换状态筛选查看其他拨打明细' : '任务派发后会在这里显示拨打明细'}</span></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
      {children}
    </div>
  );
}
