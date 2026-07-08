import Link from 'next/link';
import { Coins, Download, Gauge, PhoneCall, Timer, WalletCards } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { EmptyState } from '@/components/outbound/empty-state';

import styles from '../platform.module.scss';

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 4,
  }).format(value);
}

export default async function CostsPage({
  searchParams,
}: {
  searchParams: { campaignId?: string; scenario?: string; from?: string; to?: string };
}) {
  let overview: Awaited<ReturnType<typeof apiServer.platform.costs>> | null = null;
  let error: string | null = null;
  try {
    overview = await apiServer.platform.costs(searchParams);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>成本中心</h1>
          <p>按通话、Provider、活动和时间归因外呼成本；无用量事件时使用通话时长和转写内容估算</p>
        </div>
        <Link href="/observability" className={styles.primaryButton}>
          <Gauge size={15} />
          观测面板
        </Link>
      </header>

      <main className={styles.content}>
        {error || !overview ? (
          <EmptyState title="成本数据加载失败" description={error ?? '暂无数据'} />
        ) : (
          <>
            <section className={styles.statGrid}>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>总成本</span><WalletCards size={16} /></div>
                <strong>{money(overview.summary.totalCost)}</strong>
                <small>平均 {money(overview.summary.avgCostPerCall)} / 通</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>通话量</span><PhoneCall size={16} /></div>
                <strong>{number(overview.summary.callCount)}</strong>
                <small>接通 {number(overview.summary.connectedCalls)}</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>音频时长</span><Timer size={16} /></div>
                <strong>{number(overview.summary.totalSeconds)}s</strong>
                <small>用于话务和 STT 估算</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>Token</span><Coins size={16} /></div>
                <strong>{number(overview.summary.totalTokens)}</strong>
                <small>{overview.currency} 计价</small>
              </article>
            </section>

            <section className={styles.layoutTwo}>
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Provider 成本</h2>
                  <span>{new Date(overview.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                </div>
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>组件</th>
                        <th>Provider</th>
                        <th className={styles.numeric}>通话</th>
                        <th className={styles.numeric}>音频秒</th>
                        <th className={styles.numeric}>Token/字符</th>
                        <th className={styles.numeric}>工具调用</th>
                        <th className={styles.numeric}>成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.providers.map((item) => (
                        <tr key={`${item.component}-${item.provider}`}>
                          <td><strong>{item.component}</strong></td>
                          <td>{item.provider}</td>
                          <td className={styles.numeric}>{number(item.calls)}</td>
                          <td className={styles.numeric}>{number(item.audioSeconds)}</td>
                          <td className={styles.numeric}>{number(item.tokens)}</td>
                          <td className={styles.numeric}>{number(item.toolCalls)}</td>
                          <td className={styles.numeric}>{money(item.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>估算口径</h2>
                  <Download size={15} />
                </div>
                <ul className={styles.list}>
                  {overview.assumptions.map((item) => (
                    <li key={item}>
                      <strong>{item.split(':')[0]}</strong>
                      <p>{item.includes(':') ? item.slice(item.indexOf(':') + 1).trim() : item}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className={styles.panel} style={{ marginTop: 16 }}>
              <div className={styles.panelHeader}>
                <h2>活动成本</h2>
                <span>{overview.campaigns.length}</span>
              </div>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>活动</th>
                      <th>场景</th>
                      <th className={styles.numeric}>通话</th>
                      <th className={styles.numeric}>接通</th>
                      <th className={styles.numeric}>秒数</th>
                      <th className={styles.numeric}>Token</th>
                      <th className={styles.numeric}>总成本</th>
                      <th className={styles.numeric}>单通</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.campaigns.map((item) => (
                      <tr key={item.campaignId ?? item.campaignName}>
                        <td><strong>{item.campaignName}</strong><small>{item.campaignId ?? '未归属活动'}</small></td>
                        <td>{item.scenario}</td>
                        <td className={styles.numeric}>{number(item.calls)}</td>
                        <td className={styles.numeric}>{number(item.connectedCalls)}</td>
                        <td className={styles.numeric}>{number(item.totalSeconds)}</td>
                        <td className={styles.numeric}>{number(item.estimatedTokens)}</td>
                        <td className={styles.numeric}>{money(item.cost)}</td>
                        <td className={styles.numeric}>{money(item.avgCostPerCall)}</td>
                      </tr>
                    ))}
                    {overview.campaigns.length === 0 ? <tr><td colSpan={8}>暂无活动成本数据</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={styles.panel} style={{ marginTop: 16 }}>
              <div className={styles.panelHeader}>
                <h2>日趋势</h2>
                <span>{overview.trend.length}</span>
              </div>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead><tr><th>日期</th><th className={styles.numeric}>通话</th><th className={styles.numeric}>成本</th><th>占比</th></tr></thead>
                  <tbody>
                    {overview.trend.map((item) => {
                      const width = overview.summary.totalCost ? Math.max(4, (item.cost / overview.summary.totalCost) * 100) : 0;
                      return (
                        <tr key={item.date}>
                          <td>{item.date}</td>
                          <td className={styles.numeric}>{number(item.calls)}</td>
                          <td className={styles.numeric}>{money(item.cost)}</td>
                          <td><span className={styles.progress}><i style={{ width: `${width}%` }} /></span></td>
                        </tr>
                      );
                    })}
                    {overview.trend.length === 0 ? <tr><td colSpan={4}>暂无趋势数据</td></tr> : null}
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
