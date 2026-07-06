import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BarChart3, Download, PhoneCall, ShieldAlert, Users } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { StatusBadge, type StatusTone } from '@/components/outbound/status-badge';
import type { CampaignLeadStatus, CampaignStatus } from '@ai-call/shared';
import { CampaignStatusActions } from './CampaignStatusActions';

import styles from '../../tasks/tasks.module.scss';

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

const LEAD_STATUS: Record<CampaignLeadStatus, string> = {
  imported: '已导入',
  invalid: '无效',
  scheduled: '已排期',
  dialing: '拨打中',
  completed: '已完成',
  skipped: '已跳过',
};

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '立即开始';
}

export default async function CampaignDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let campaign: Awaited<ReturnType<typeof apiServer.campaigns.get>>;
  let strategy: Awaited<ReturnType<typeof apiServer.campaigns.strategySimulation>> | null = null;
  try {
    campaign = await apiServer.campaigns.get(params.id);
    strategy = await apiServer.campaigns.strategySimulation(params.id).catch(() => null);
  } catch {
    notFound();
  }

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <Link href="/campaigns" className={styles.toolButton} style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} />
            返回活动
          </Link>
          <h1>{campaign.name}</h1>
          <p>计划时间：{formatDate(campaign.scheduledAt)} · 活动 ID：{campaign.id}</p>
        </div>
        <div className={styles.tools}>
          <Link href={`/analytics?campaignId=${campaign.id}`} className={styles.primaryButton}>
            <BarChart3 size={15} />
            查看分析
          </Link>
          <CampaignStatusActions campaignId={campaign.id} status={campaign.status} />
          <button type="button" className={styles.toolButton}><Download size={14} />导出</button>
        </div>
      </header>

      <main className={styles.content}>
        <section className={styles.statGrid}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>活动状态</span><PhoneCall size={16} /></div>
            <strong style={{ fontFamily: 'inherit', fontSize: 16 }}>
              <StatusBadge tone={STATUS_TONE[campaign.status]}>{STATUS_LABELS[campaign.status]}</StatusBadge>
            </strong>
            <small>并发上限 {campaign.concurrencyLimit}</small>
            <p className={styles.muted}>最多拨打 {campaign.retryPolicy.maxAttempts} 次</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>名单总量</span><Users size={16} /></div>
            <strong>{number(campaign.stats.totalLeads)}</strong>
            <small>有效 {number(campaign.stats.validLeads)} · 异常 {number(campaign.stats.invalidLeads)}</small>
            <p className={styles.muted}>导入批次 {campaign.importBatches.length}</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>拨打进度</span><PhoneCall size={16} /></div>
            <strong>{number(campaign.stats.dialed)}</strong>
            <small>接通 {number(campaign.stats.connected)} · 失败 {number(campaign.stats.failed)}</small>
            <p className={styles.positive}>接通率 {campaign.stats.connectRate}%</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>目标达成</span><BarChart3 size={16} /></div>
            <strong>{number(campaign.stats.converted)}</strong>
            <small>转人工 {number(campaign.stats.escalated)}</small>
            <p className={styles.positive}>转化率 {campaign.stats.conversionRate}%</p>
          </article>
        </section>

        {strategy ? (
          <section className={styles.tableShell} style={{ padding: 16, marginTop: 14 }}>
            <div className={styles.statLabel}>
              <span>策略模拟</span>
              <ShieldAlert size={16} />
            </div>
            <div className="tag-list" style={{ marginTop: 10 }}>
              <span className="badge badge-success">可拨 {number(strategy.callableLeads)}</span>
              <span className="badge badge-warning">拦截 {number(strategy.blockedLeads)}</span>
              <span className="badge badge-neutral">预计任务 {number(strategy.estimatedTasks)}</span>
            </div>
            <div className="tag-list" style={{ marginTop: 10 }}>
              {strategy.blockReasons.map((item) => (
                <span key={item.reason} className="badge badge-neutral">
                  {item.reason}: {item.count}
                </span>
              ))}
              {strategy.blockReasons.length === 0 ? <span className="badge badge-success">暂无策略拦截</span> : null}
            </div>
          </section>
        ) : null}

        <section className={styles.toolbar}>
          <div className={styles.segments}>
            <Link href={`/campaigns/${campaign.id}`} className={styles.active}>名单明细</Link>
            <Link href={`/analytics?campaignId=${campaign.id}`}>效果分析</Link>
          </div>
        </section>

        <div className={styles.tableShell}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>客户</th>
                  <th>状态</th>
                  <th>号码</th>
                  <th>变量</th>
                  <th>异常原因</th>
                  <th>创建时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {campaign.leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <div className={styles.taskLink}>
                        <strong>{lead.displayName || lead.variables.customerName || `第 ${lead.rowNumber} 行`}</strong>
                        <span>{lead.id}</span>
                      </div>
                    </td>
                    <td><StatusBadge tone={lead.status === 'invalid' ? 'failed' : lead.status === 'completed' ? 'completed' : 'pending'}>{LEAD_STATUS[lead.status]}</StatusBadge></td>
                    <td>{lead.phoneNumber}</td>
                    <td>
                      <div className="tag-list">
                        {Object.entries(lead.variables).slice(0, 3).map(([key, value]) => (
                          <span key={key} className="badge badge-neutral">{key}: {value}</span>
                        ))}
                      </div>
                    </td>
                    <td className={styles.creator}>{lead.validationError || '-'}</td>
                    <td><div className={styles.date}><span>{formatDate(lead.createdAt)}</span></div></td>
                    <td>
                      {lead.taskId ? (
                        <Link href={`/tasks/${lead.taskId}`} className={styles.rowIcon} aria-label="查看任务">
                          <PhoneCall size={14} />
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
