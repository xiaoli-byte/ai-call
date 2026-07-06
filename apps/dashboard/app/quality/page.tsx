import Link from 'next/link';
import { AlertTriangle, ClipboardCheck, PhoneCall, ShieldCheck } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import { StatusBadge, type StatusTone } from '@/components/outbound/status-badge';
import type { QualityRiskLevel } from '@ai-call/shared';

import styles from '../tasks/tasks.module.scss';

const RISK_LABELS: Record<QualityRiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const RISK_TONE: Record<QualityRiskLevel, StatusTone> = {
  low: 'completed',
  medium: 'paused',
  high: 'failed',
};

export default async function QualityPage({
  searchParams,
}: {
  searchParams: { riskLevel?: QualityRiskLevel };
}) {
  let page: Awaited<ReturnType<typeof apiServer.quality.list>> = { items: [] };
  let error: string | null = null;
  try {
    page = await apiServer.quality.list({ riskLevel: searchParams.riskLevel, limit: 50 });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  const highRisk = page.items.filter((item) => item.riskLevel === 'high').length;
  const mediumRisk = page.items.filter((item) => item.riskLevel === 'medium').length;
  const flagged = page.items.filter((item) => item.complianceFlags.length > 0).length;

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <h1>通话质检</h1>
          <p>查看通话后摘要、客户意向、合规风险和下一步动作</p>
        </div>
        <Link href="/compliance" className={styles.primaryButton}>
          <ShieldCheck size={15} />
          合规中心
        </Link>
      </header>

      <main className={styles.content}>
        <section className={styles.statGrid}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>分析记录</span><ClipboardCheck size={16} /></div>
            <strong>{page.items.length}</strong>
            <small>当前列表</small>
            <p className={styles.muted}>来自 CallAnalysis</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>高风险</span><AlertTriangle size={16} /></div>
            <strong>{highRisk}</strong>
            <small>需要优先复核</small>
            <p className={highRisk ? styles.positive : styles.muted}>风险自动识别</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>中风险</span><AlertTriangle size={16} /></div>
            <strong>{mediumRisk}</strong>
            <small>建议抽检</small>
            <p className={styles.muted}>可人工修正</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>合规标签</span><ShieldCheck size={16} /></div>
            <strong>{flagged}</strong>
            <small>含风险标签记录</small>
            <p className={styles.muted}>例如退订/披露缺失</p>
          </article>
        </section>

        <section className={styles.toolbar}>
          <nav className={styles.segments}>
            <Link href="/quality" className={!searchParams.riskLevel ? styles.active : ''}>全部</Link>
            <Link href="/quality?riskLevel=high" className={searchParams.riskLevel === 'high' ? styles.active : ''}>高风险</Link>
            <Link href="/quality?riskLevel=medium" className={searchParams.riskLevel === 'medium' ? styles.active : ''}>中风险</Link>
            <Link href="/quality?riskLevel=low" className={searchParams.riskLevel === 'low' ? styles.active : ''}>低风险</Link>
          </nav>
        </section>

        {error ? (
          <EmptyState title="质检加载失败" description={error} />
        ) : page.items.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={24} />} title="暂无质检记录" description="通话分析生成后会显示在这里" />
        ) : (
          <div className={styles.tableShell}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>通话</th>
                    <th>风险</th>
                    <th>客户意向</th>
                    <th>业务结果</th>
                    <th>摘要</th>
                    <th>下一步</th>
                    <th>置信度</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className={styles.taskLink}>
                          <strong>{item.to ?? item.callAttemptId}</strong>
                          <span>{item.scenario ?? item.taskId}</span>
                        </div>
                      </td>
                      <td><StatusBadge tone={RISK_TONE[item.riskLevel]}>{RISK_LABELS[item.riskLevel]}</StatusBadge></td>
                      <td>{item.intent}</td>
                      <td>{item.outcome ?? '-'}</td>
                      <td>{item.summary}</td>
                      <td>{item.nextAction}</td>
                      <td>{Math.round(item.confidence * 100)}%</td>
                      <td>
                        <Link href={`/tasks/${item.taskId}/calls/${item.callAttemptId}`} className={styles.rowIcon} aria-label="查看通话">
                          <PhoneCall size={14} />
                        </Link>
                      </td>
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
