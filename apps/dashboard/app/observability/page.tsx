import Link from 'next/link';
import { Activity, AlertTriangle, Gauge, Server, Wifi } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import type { PlatformHealthStatus } from '@ai-call/shared';

import styles from '../platform.module.scss';

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function statusClass(status: PlatformHealthStatus) {
  if (status === 'healthy') return styles.badgeHealthy;
  if (status === 'down') return styles.badgeDanger;
  if (status === 'degraded') return styles.badgeWarning;
  return '';
}

export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; provider?: string };
}) {
  let overview: Awaited<ReturnType<typeof apiServer.platform.observability>> | null = null;
  let error: string | null = null;
  try {
    overview = await apiServer.platform.observability(searchParams);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>观测与健康</h1>
          <p>Provider 延迟、错误率、调度积压、工具调用和本地部署依赖健康状态</p>
        </div>
        <Link href="/costs" className={styles.primaryButton}>
          <Gauge size={15} />
          成本中心
        </Link>
      </header>

      <main className={styles.content}>
        {error || !overview ? (
          <EmptyState title="观测数据加载失败" description={error ?? '暂无数据'} />
        ) : (
          <>
            <section className={styles.statGrid}>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>事件总量</span><Activity size={16} /></div>
                <strong>{number(overview.summary.totalEvents)}</strong>
                <small>成功率 {overview.summary.successRate}%</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>错误率</span><AlertTriangle size={16} /></div>
                <strong className={overview.summary.errorRate >= 10 ? styles.danger : styles.positive}>
                  {overview.summary.errorRate}%
                </strong>
                <small>工具失败率 {overview.summary.toolFailureRate}%</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>平均延迟</span><Gauge size={16} /></div>
                <strong>{number(overview.summary.avgLatencyMs)}ms</strong>
                <small>按有延迟样本聚合</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>运行队列</span><Server size={16} /></div>
                <strong>{number(overview.summary.schedulerBacklog)}</strong>
                <small>活跃通话 {number(overview.summary.activeCalls)}</small>
              </article>
            </section>

            <section className={styles.layoutTwo}>
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Provider 指标</h2>
                  <span>{new Date(overview.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                </div>
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>组件</th>
                        <th>Provider</th>
                        <th className={styles.numeric}>事件</th>
                        <th className={styles.numeric}>错误</th>
                        <th className={styles.numeric}>平均延迟</th>
                        <th className={styles.numeric}>P95</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.providers.map((item) => (
                        <tr key={`${item.component}-${item.provider}`}>
                          <td><strong>{item.component}</strong><small>{item.lastEventAt ? new Date(item.lastEventAt).toLocaleString('zh-CN', { hour12: false }) : '暂无事件'}</small></td>
                          <td>{item.provider}</td>
                          <td className={styles.numeric}>{number(item.eventCount)}</td>
                          <td className={styles.numeric}>{item.errorRate}%</td>
                          <td className={styles.numeric}>{number(item.avgLatencyMs)}ms</td>
                          <td className={styles.numeric}>{number(item.p95LatencyMs)}ms</td>
                          <td><span className={cn(styles.badge, statusClass(item.status))}>{item.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>部署健康</h2>
                  <Wifi size={15} />
                </div>
                <ul className={styles.list}>
                  {overview.healthChecks.map((item) => (
                    <li key={`${item.component}-${item.name}`}>
                      <div className={styles.cardHeader}>
                        <strong>{item.name}</strong>
                        <span className={cn(styles.badge, statusClass(item.status))}>{item.status}</span>
                      </div>
                      <p>{item.message}</p>
                      {item.action ? <p className={styles.warning}>{item.action}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className={styles.layoutTwo}>
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>告警</h2>
                  <span>{overview.alerts.length}</span>
                </div>
                <ul className={styles.list}>
                  {overview.alerts.map((item) => (
                    <li key={item.id}>
                      <div className={styles.cardHeader}>
                        <strong>{item.title}</strong>
                        <span className={cn(styles.badge, item.severity === 'critical' ? styles.badgeDanger : styles.badgeWarning)}>
                          {item.severity}
                        </span>
                      </div>
                      <p>{item.description}</p>
                      <p className={styles.warning}>{item.action}</p>
                    </li>
                  ))}
                  {overview.alerts.length === 0 ? <li><strong>暂无告警</strong><p>最近窗口未发现阻断项。</p></li> : null}
                </ul>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>最近错误</h2>
                  <span>{overview.recentErrors.length}</span>
                </div>
                <ul className={styles.list}>
                  {overview.recentErrors.map((item) => (
                    <li key={item.id}>
                      <strong>{item.source}</strong>
                      <p>{item.message}</p>
                      <p className={styles.muted}>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</p>
                    </li>
                  ))}
                  {overview.recentErrors.length === 0 ? <li><strong>暂无错误</strong><p>最近窗口没有失败事件。</p></li> : null}
                </ul>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
