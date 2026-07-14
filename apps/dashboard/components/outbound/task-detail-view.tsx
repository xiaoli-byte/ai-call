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
  PhoneCall,
  Radio,
  XCircle,
} from 'lucide-react';
import { TaskStatus, type OutboundTask } from '@ai-call/shared';
import { cn } from '@/lib/utils';

import { EmptyState } from './empty-state';
import { StatusBadge, type StatusTone } from './status-badge';
import styles from './task-detail-view.module.scss';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待拨打',
  calling: '拨打中',
  in_call: '通话中',
  completed: '已接通',
  failed: '呼叫失败',
  no_answer: '未接听',
  cancelled: '已暂停',
};

const STATUS_TONE: Record<TaskStatus, StatusTone> = {
  pending: 'pending',
  calling: 'running',
  in_call: 'running',
  completed: 'completed',
  failed: 'failed',
  no_answer: 'paused',
  cancelled: 'paused',
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

  // “导出任务”：把本视图已加载的任务字段（含通话转写 task.transcript）
  // 导出为 JSON 文件，纯客户端生成，不发起额外网络请求。
  function handleExportTask() {
    const payload = { ...task, scenarioName };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const dateStamp = new Date().toISOString().slice(0, 10);
    anchor.download = `task-${task.id}-${dateStamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <Link href="/tasks" className={styles.back}><ArrowLeft size={14} />返回外呼任务</Link>
        <div className={styles.titleRow}>
          <div>
            <div className={styles.titleWithStatus}>
              <h1>{scenarioName}外呼任务</h1>
              <StatusBadge tone={STATUS_TONE[task.status]}>{STATUS_LABELS[task.status]}</StatusBadge>
            </div>
            <p><code>{task.id}</code><span><PhoneCall size={12} />{scenarioName}</span><span><Clock3 size={12} />{formatDate(task.createdAt)}</span></p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.actionButton} onClick={handleExportTask}><Download size={14} />导出任务</button>
          </div>
        </div>
      </header>

      <main className={styles.content}>
        <section className={styles.stats}>
          <article><span>总外呼量</span><strong>{total.toLocaleString('zh-CN')}</strong><small>预计共 {total.toLocaleString('zh-CN')} 通</small></article>
          <article className={styles.statSuccess}><span>已接通</span><strong>{connected}</strong><small><CheckCircle2 size={12} />成功接通</small></article>
          <article className={styles.statRunning}><span>进行中</span><strong>{running}</strong><small><Radio size={12} />实时执行中</small></article>
          <article className={styles.statFailed}><span>未接听 / 失败</span><strong>{failed}</strong><small><XCircle size={12} />需后续处理</small></article>
          <article><span>平均通话时长</span><strong>{formatDuration(averageDuration)}</strong><small>实时均值</small></article>
        </section>

        <section className={styles.progressCard}>
          <div className={styles.progressHeader}><strong>任务进度</strong><span>{finished} / {total} 已处理</span></div>
          <div className={styles.progressTrack}>
            <i className={styles.progressDone} style={{ width: `${Math.min((connected / total) * 100, 100)}%` }} />
            <i className={styles.progressFailed} style={{ width: `${Math.min((failed / total) * 100, 100)}%` }} />
          </div>
          <p className={styles.progressLegend}>
            <span className={styles.greenDot}>已接通 {connected}</span>
            <span className={styles.redDot}>失败 {failed}</span>
            <span>待处理 {Math.max(total - finished, 0)}</span>
          </p>
        </section>

        <section className={styles.records}>
          <div className={styles.sectionHeading}>
            <h2>外呼记录明细</h2>
            <div className={styles.segments} role="tablist" aria-label="外呼记录状态">
              {DETAIL_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={filter === item.value ? styles.active : ''}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.tableShell}>
            <div className={styles.tableScroll}>
              <table className={cn(styles.table, styles.recordTable)}>
                <thead><tr><th>客户信息</th><th>呼叫状态</th><th>呼叫时间</th><th className={styles.numeric}>通话时长</th><th>意图识别</th><th>外呼结果</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {filteredAttempts.length ? filteredAttempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td><Link className={styles.customer} href={`/tasks/${task.id}/calls/${attempt.id}`}><strong>{customerName}</strong><span>{task.to}</span></Link></td>
                      <td><StatusBadge tone={STATUS_TONE[attempt.status]}>{STATUS_LABELS[attempt.status]}</StatusBadge></td>
                      <td className={styles.mono}>{formatDate(attempt.startedAt)}</td>
                      <td className={cn(styles.numeric, styles.mono)}>{formatDuration(attempt.duration)}</td>
                      <td>{task.intentTags?.length ? <span className={styles.intent}>{task.intentTags[0]}</span> : <span className={styles.muted}>—</span>}</td>
                      <td className={styles.result}>{attempt.hangupCause || (attempt.status === 'completed' ? '通话已完成' : STATUS_LABELS[attempt.status])}</td>
                      <td>
                        <Link href={`/tasks/${task.id}/calls/${attempt.id}`} className={styles.rowAction}>
                          <Eye size={12} />
                          查看对话
                        </Link>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          compact
                          icon={<Headphones size={20} />}
                          title={attempts.length ? '当前筛选暂无记录' : '暂无外呼记录'}
                          description={attempts.length ? '切换状态筛选查看其他拨打明细' : '任务派发后会在这里显示拨打明细'}
                        />
                      </td>
                    </tr>
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
