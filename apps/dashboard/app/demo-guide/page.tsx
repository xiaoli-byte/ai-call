import Link from 'next/link';
import { CheckCircle2, ClipboardList, Database, Gauge, PlayCircle } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import type { DemoGuideStep, PlatformHealthStatus } from '@ai-call/shared';

import styles from '../platform.module.scss';

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function statusClass(status: PlatformHealthStatus | DemoGuideStep['status']) {
  if (status === 'healthy' || status === 'ready') return styles.badgeHealthy;
  if (status === 'down' || status === 'blocked') return styles.badgeDanger;
  if (status === 'degraded' || status === 'warning') return styles.badgeWarning;
  return '';
}

export default async function DemoGuidePage() {
  let overview: Awaited<ReturnType<typeof apiServer.platform.demoGuide>> | null = null;
  let error: string | null = null;
  try {
    overview = await apiServer.platform.demoGuide();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>演示交付</h1>
          <p>样例数据、运行健康、模板克隆、任务创建、结果复盘的演示路径</p>
        </div>
        <Link href="/templates" className={styles.primaryButton}>
          <PlayCircle size={15} />
          开始演示
        </Link>
      </header>

      <main className={styles.content}>
        {error || !overview ? (
          <EmptyState title="演示引导加载失败" description={error ?? '暂无数据'} />
        ) : (
          <>
            <section className={styles.statGrid}>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>就绪度</span><CheckCircle2 size={16} /></div>
                <strong>{overview.readinessScore}%</strong>
                <small>{new Date(overview.generatedAt).toLocaleString('zh-CN', { hour12: false })}</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>场景/流程</span><ClipboardList size={16} /></div>
                <strong>{number(overview.sampleData.scenarios)} / {number(overview.sampleData.flows)}</strong>
                <small>可直接绑定外呼任务</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>外呼任务</span><Database size={16} /></div>
                <strong>{number(overview.sampleData.tasks)}</strong>
                <small>{overview.resetCommand}</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>分析样本</span><Gauge size={16} /></div>
                <strong>{number(overview.sampleData.analyses)}</strong>
                <small>用于质检和洞察</small>
              </article>
            </section>

            <section className={styles.stepGrid} style={{ marginTop: 16 }}>
              {overview.steps.map((step) => (
                <article key={step.id} className={styles.stepCard}>
                  <div className={styles.cardHeader}>
                    <h2>{step.title}</h2>
                    <span className={cn(styles.badge, statusClass(step.status))}>{step.status}</span>
                  </div>
                  <p>{step.description}</p>
                  {step.action ? <p className={styles.warning}>{step.action}</p> : null}
                  {step.href ? (
                    <div className={styles.cardFooter}>
                      <span />
                      <Link href={step.href} className={styles.secondaryButton}>进入</Link>
                    </div>
                  ) : null}
                </article>
              ))}
            </section>

            <section className={styles.panel} style={{ marginTop: 16 }}>
              <div className={styles.panelHeader}>
                <h2>健康检查</h2>
                <span>{overview.healthChecks.length}</span>
              </div>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>组件</th>
                      <th>状态</th>
                      <th>说明</th>
                      <th>处理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.healthChecks.map((item) => (
                      <tr key={`${item.component}-${item.name}`}>
                        <td><strong>{item.name}</strong><small>{item.component}</small></td>
                        <td><span className={cn(styles.badge, statusClass(item.status))}>{item.status}</span></td>
                        <td>{item.message}</td>
                        <td>{item.action ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
