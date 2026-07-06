import Link from 'next/link';
import { BarChart3, ClipboardList, PhoneCall, TrendingUp, Users } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';

import styles from '../tasks/tasks.module.scss';

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { campaignId?: string; scenario?: string; from?: string; to?: string };
}) {
  let overview: Awaited<ReturnType<typeof apiServer.analytics.overview>> | null = null;
  let error: string | null = null;
  try {
    overview = await apiServer.analytics.overview(searchParams);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <h1>效果分析</h1>
          <p>按活动、场景和时间查看外呼漏斗、失败原因和业务结果</p>
        </div>
        <Link href="/campaigns" className={styles.primaryButton}>
          <ClipboardList size={15} />
          外呼活动
        </Link>
      </header>

      <main className={styles.content}>
        {error || !overview ? (
          <EmptyState title="分析加载失败" description={error ?? '暂无数据'} />
        ) : (
          <>
            <section className={styles.statGrid}>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>任务总数</span><Users size={16} /></div>
                <strong>{number(overview.funnel.totalTasks)}</strong>
                <small>有效名单 {number(overview.funnel.validLeads)}</small>
                <p className={styles.muted}>待拨 {number(overview.funnel.scheduled)}</p>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>已拨打</span><PhoneCall size={16} /></div>
                <strong>{number(overview.funnel.dialed)}</strong>
                <small>接通 {number(overview.funnel.connected)}</small>
                <p className={styles.positive}>接通率 {overview.rates.connectRate}%</p>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>目标达成</span><TrendingUp size={16} /></div>
                <strong>{number(overview.funnel.converted)}</strong>
                <small>转人工 {number(overview.funnel.escalated)}</small>
                <p className={styles.positive}>转化率 {overview.rates.conversionRate}%</p>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>平均时长</span><BarChart3 size={16} /></div>
                <strong>{overview.averageDurationSeconds}s</strong>
                <small>失败率 {overview.rates.failureRate}%</small>
                <p className={styles.muted}>生成于 {new Date(overview.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</p>
              </article>
            </section>

            <section className={styles.toolbar}>
              <div className={styles.segments}>
                <Link href="/analytics" className={!searchParams.campaignId ? styles.active : ''}>全部</Link>
                {searchParams.campaignId && <Link href={`/analytics?campaignId=${searchParams.campaignId}`} className={styles.active}>当前活动</Link>}
              </div>
            </section>

            <div className={styles.tableShell}>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>活动/场景</th>
                      <th className="numeric">任务</th>
                      <th className="numeric">拨打</th>
                      <th className="numeric">接通</th>
                      <th className="numeric">达成</th>
                      <th>接通率</th>
                      <th>转化率</th>
                      <th aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {overview.campaigns.map((item, index) => (
                      <tr key={item.campaignId ?? `scenario-${index}`}>
                        <td>
                          <div className={styles.taskLink}>
                            <strong>{item.campaignName ?? '未归属活动'}</strong>
                            <span>{item.scenario}</span>
                          </div>
                        </td>
                        <td className={styles.numeric}>{number(item.totalTasks)}</td>
                        <td className={styles.numeric}>{number(item.dialed)}</td>
                        <td className={styles.numeric}>{number(item.connected)}</td>
                        <td className={styles.numeric}>{number(item.converted)}</td>
                        <td><div className={styles.rate}><span><i style={{ width: `${Math.max(item.connectRate, 3)}%` }} /></span><b>{item.connectRate}%</b></div></td>
                        <td><div className={styles.rate}><span><i style={{ width: `${Math.max(item.conversionRate, 3)}%` }} /></span><b>{item.conversionRate}%</b></div></td>
                        <td>{item.campaignId ? <Link href={`/campaigns/${item.campaignId}`} className={styles.rowIcon}>→</Link> : null}</td>
                      </tr>
                    ))}
                    {overview.campaigns.length === 0 && <tr><td colSpan={8}>暂无分析数据</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.tableShell} style={{ marginTop: 16 }}>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead><tr><th>失败原因</th><th className="numeric">数量</th><th>占比</th><th>业务结果</th><th className="numeric">数量</th><th>占比</th><th /><th /></tr></thead>
                  <tbody>
                    {Array.from({ length: Math.max(overview.failureReasons.length, overview.outcomeBuckets.length, 1) }).map((_, index) => {
                      const failure = overview.failureReasons[index];
                      const outcome = overview.outcomeBuckets[index];
                      return (
                        <tr key={index}>
                          <td>{failure?.reason ?? '-'}</td>
                          <td className={styles.numeric}>{failure ? number(failure.count) : '-'}</td>
                          <td>{failure ? `${failure.rate}%` : '-'}</td>
                          <td>{outcome?.reason ?? '-'}</td>
                          <td className={styles.numeric}>{outcome ? number(outcome.count) : '-'}</td>
                          <td>{outcome ? `${outcome.rate}%` : '-'}</td>
                          <td />
                          <td />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
