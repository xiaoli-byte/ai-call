import Link from 'next/link';
import { ClipboardCheck, PhoneForwarded, UserCheck, Users } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import { StatusBadge, type StatusTone } from '@/components/outbound/status-badge';
import type { HandoffTicketStatus } from '@ai-call/shared';
import { HandoffActions } from './HandoffActions';

import styles from '../tasks/tasks.module.scss';

const STATUS_LABELS: Record<HandoffTicketStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  closed: '已关闭',
};

const STATUS_TONE: Record<HandoffTicketStatus, StatusTone> = {
  pending: 'pending',
  processing: 'running',
  completed: 'completed',
  closed: 'paused',
};

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

export default async function HandoffsPage({
  searchParams,
}: {
  searchParams: { status?: HandoffTicketStatus };
}) {
  let page: Awaited<ReturnType<typeof apiServer.handoffs.list>> = {
    items: [],
    counts: { pending: 0, processing: 0, completed: 0, closed: 0 },
  };
  let error: string | null = null;
  try {
    page = await apiServer.handoffs.list({ status: searchParams.status, limit: 50 });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <h1>人工承接</h1>
          <p>处理 AI 通话触发的转人工、投诉风险和回拨需求。</p>
        </div>
      </header>

      <main className={styles.content}>
        <section className={styles.statGrid}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>待处理</span><Users size={16} /></div>
            <strong>{page.counts.pending}</strong>
            <small>新转人工工单</small>
            <p className={styles.muted}>需坐席认领</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>处理中</span><UserCheck size={16} /></div>
            <strong>{page.counts.processing}</strong>
            <small>坐席跟进中</small>
            <p className={styles.positive}>承接中</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>已完成</span><ClipboardCheck size={16} /></div>
            <strong>{page.counts.completed}</strong>
            <small>有明确处置结果</small>
            <p className={styles.muted}>闭环率指标</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>回拨任务</span><PhoneForwarded size={16} /></div>
            <strong>{page.items.filter((item) => item.callbackTaskId).length}</strong>
            <small>当前列表</small>
            <p className={styles.muted}>可回到外呼任务</p>
          </article>
        </section>

        <section className={styles.toolbar}>
          <nav className={styles.segments}>
            <Link href="/handoffs" className={!searchParams.status ? styles.active : ''}>全部</Link>
            {(['pending', 'processing', 'completed', 'closed'] as HandoffTicketStatus[]).map((status) => (
              <Link key={status} href={`/handoffs?status=${status}`} className={searchParams.status === status ? styles.active : ''}>
                {STATUS_LABELS[status]}
              </Link>
            ))}
          </nav>
        </section>

        {error ? (
          <EmptyState title="人工承接加载失败" description={error} />
        ) : page.items.length === 0 ? (
          <EmptyState title="暂无人工承接工单" description="通话触发转人工或高风险质检后会出现在这里。" />
        ) : (
          <div className={styles.tableShell}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>客户</th>
                    <th>状态</th>
                    <th>意图</th>
                    <th>摘要</th>
                    <th>推荐动作</th>
                    <th>风险</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((item) => (
                    <tr key={item.id}>
                      <td><div className={styles.taskLink}><strong>{item.customerName || item.phoneNumber}</strong><span>{item.phoneNumber}</span></div></td>
                      <td><StatusBadge tone={STATUS_TONE[item.status]}>{STATUS_LABELS[item.status]}</StatusBadge></td>
                      <td>{item.intent}</td>
                      <td>{item.summary}</td>
                      <td>{item.recommendedAction}</td>
                      <td><div className="tag-list">{item.riskTags.map((tag) => <span key={tag} className="badge badge-warning">{tag}</span>)}</div></td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td><HandoffActions id={item.id} status={item.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
