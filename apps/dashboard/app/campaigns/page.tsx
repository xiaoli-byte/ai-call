import Link from 'next/link';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  PhoneCall,
  Plus,
  TrendingUp,
  Users,
} from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import { StatusBadge, type StatusTone } from '@/components/outbound/status-badge';
import type { CampaignStatus } from '@ai-call/shared';

import styles from '../tasks/tasks.module.scss';

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: '草稿',
  scheduled: '已排期',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
};

const STATUS_TONE: Record<CampaignStatus, StatusTone> = {
  draft: 'pending',
  scheduled: 'pending',
  running: 'running',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
};

const FILTERS = [
  { label: '全部', value: '' },
  { label: '已排期', value: 'scheduled' },
  { label: '运行中', value: 'running' },
  { label: '已暂停', value: 'paused' },
  { label: '已完成', value: 'completed' },
] as const;

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '立即开始';
}

function filterHref(status: string) {
  return `/campaigns${status ? `?status=${status}` : ''}`;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: { status?: CampaignStatus };
}) {
  let page: Awaited<ReturnType<typeof apiServer.campaigns.list>> = { items: [] };
  let scenarios: Awaited<ReturnType<typeof apiServer.scenarios.list>> = [];
  let error: string | null = null;

  try {
    [page, scenarios] = await Promise.all([
      apiServer.campaigns.list({ status: searchParams.status, limit: 50 }),
      apiServer.scenarios.list(),
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  const scenarioNames = new Map(scenarios.map((item) => [item.scenario, item.name]));
  const campaigns = page.items;
  const totalLeads = campaigns.reduce((sum, item) => sum + item.stats.totalLeads, 0);
  const dialed = campaigns.reduce((sum, item) => sum + item.stats.dialed, 0);
  const converted = campaigns.reduce((sum, item) => sum + item.stats.converted, 0);
  const connected = campaigns.reduce((sum, item) => sum + item.stats.connected, 0);
  const connectRate = dialed ? Math.round((connected / dialed) * 1000) / 10 : 0;

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <h1>外呼活动</h1>
          <p>按活动管理名单、排期、拨打进度和业务结果</p>
        </div>
        <Link href="/campaigns/new" className={styles.primaryButton}>
          <Plus size={15} />
          新建活动
        </Link>
      </header>

      <main className={styles.content}>
        <section className={styles.statGrid} aria-label="活动统计">
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>活动数</span><ClipboardList size={16} /></div>
            <strong>{number(campaigns.length)}</strong>
            <small>当前列表活动</small>
            <p className={styles.positive}><TrendingUp size={12} /> 活动级运营视图</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>名单量</span><Users size={16} /></div>
            <strong>{number(totalLeads)}</strong>
            <small>已导入客户</small>
            <p className={styles.muted}>有效名单随活动统计</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>累计拨打</span><PhoneCall size={16} /></div>
            <strong>{number(dialed)}</strong>
            <small>已进入外呼链路</small>
            <p className={styles.positive}>接通率 {connectRate}%</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>目标达成</span><BarChart3 size={16} /></div>
            <strong>{number(converted)}</strong>
            <small>高/中意向结果</small>
            <p className={styles.muted}>来自通话结果</p>
          </article>
        </section>

        <section className={styles.toolbar}>
          <nav className={styles.segments} aria-label="活动状态">
            {FILTERS.map((item) => (
              <Link
                key={item.label}
                href={filterHref(item.value)}
                className={(searchParams.status ?? '') === item.value ? styles.active : ''}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.tools}>
            <Link href="/analytics" className={styles.toolButton}><BarChart3 size={14} />效果分析</Link>
            <Link href="/quality" className={styles.toolButton}><ClipboardList size={14} />质检列表</Link>
          </div>
        </section>

        {error ? (
          <EmptyState title="活动加载失败" description={error} />
        ) : campaigns.length === 0 ? (
          <EmptyState icon={<ClipboardList size={24} />} title="暂无外呼活动" description="创建活动后会在这里追踪名单和拨打结果" />
        ) : (
          <div className={styles.tableShell}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>活动信息</th>
                    <th>状态</th>
                    <th>场景</th>
                    <th className="numeric">名单 / 拨打 / 接通</th>
                    <th>转化率</th>
                    <th>计划时间</th>
                    <th>并发</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => {
                    const scenarioName = scenarioNames.get(campaign.scenario) ?? campaign.scenario;
                    return (
                      <tr key={campaign.id}>
                        <td>
                          <Link href={`/campaigns/${campaign.id}`} className={styles.taskLink}>
                            <strong>{campaign.name}</strong>
                            <span>{campaign.id}</span>
                          </Link>
                        </td>
                        <td><StatusBadge tone={STATUS_TONE[campaign.status]}>{STATUS_LABELS[campaign.status]}</StatusBadge></td>
                        <td><span className={styles.robot}><PhoneCall size={13} />{scenarioName}</span></td>
                        <td className={cn(styles.numeric, styles.counts)}>
                          <b>{number(campaign.stats.totalLeads)}</b><span>/</span><em>{number(campaign.stats.dialed)}</em><span>/</span><i>{number(campaign.stats.connected)}</i>
                        </td>
                        <td>
                          <div className={styles.rate}>
                            <span><i style={{ width: `${Math.max(campaign.stats.conversionRate, 3)}%` }} /></span>
                            <b>{campaign.stats.conversionRate}%</b>
                          </div>
                        </td>
                        <td><div className={styles.date}><span>{formatDate(campaign.scheduledAt)}</span><small>重拨 {campaign.retryPolicy.maxAttempts} 次</small></div></td>
                        <td className={styles.creator}>{campaign.concurrencyLimit}</td>
                        <td>
                          <Link href={`/campaigns/${campaign.id}`} className={styles.rowIcon} aria-label={`查看 ${campaign.name}`}>
                            <ChevronRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
