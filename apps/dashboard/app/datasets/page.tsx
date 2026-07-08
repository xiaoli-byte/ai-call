import Link from 'next/link';
import { ClipboardCheck, Lightbulb, ListChecks, MessageSquareWarning } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { EmptyState } from '@/components/outbound/empty-state';

import styles from '../platform.module.scss';

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export default async function DatasetsPage() {
  let overview: Awaited<ReturnType<typeof apiServer.platform.datasets>> | null = null;
  let error: string | null = null;
  try {
    overview = await apiServer.platform.datasets();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  const topRefusal = overview?.topRefusalReasons[0];
  const topLowConfidence = overview?.lowConfidenceQuestions[0];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>数据闭环</h1>
          <p>通话样本、拒绝原因聚类、低置信知识问题、风险分布和优化建议</p>
        </div>
        <Link href="/quality" className={styles.primaryButton}>
          <ClipboardCheck size={15} />
          通话质检
        </Link>
      </header>

      <main className={styles.content}>
        {error || !overview ? (
          <EmptyState title="数据洞察加载失败" description={error ?? '暂无数据'} />
        ) : (
          <>
            <section className={styles.statGrid}>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>样本数</span><ListChecks size={16} /></div>
                <strong>{number(overview.sampleCount)}</strong>
                <small>已人工修正 {number(overview.labeledSampleCount)}</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>Top 拒绝</span><MessageSquareWarning size={16} /></div>
                <strong>{topRefusal?.count ?? 0}</strong>
                <small>{topRefusal?.label ?? '暂无'}</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>知识低置信</span><Lightbulb size={16} /></div>
                <strong>{topLowConfidence?.count ?? 0}</strong>
                <small>{topLowConfidence?.label ?? '暂无'}</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>建议</span><Lightbulb size={16} /></div>
                <strong>{number(overview.suggestions.length)}</strong>
                <small>{new Date(overview.generatedAt).toLocaleString('zh-CN', { hour12: false })}</small>
              </article>
            </section>

            <section className={styles.layoutTwo}>
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>优化建议</h2>
                  <span>{overview.suggestions.length}</span>
                </div>
                <ul className={styles.list}>
                  {overview.suggestions.map((item) => (
                    <li key={item.id}>
                      <div className={styles.cardHeader}>
                        <strong>{item.title}</strong>
                        <span className={styles.badge}>{item.priority}</span>
                      </div>
                      <p>{item.description}</p>
                      <p className={styles.muted}>{item.targetModule} · {item.evidence}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>拒绝与风险</h2>
                  <span>{overview.topRefusalReasons.length + overview.riskDistribution.length}</span>
                </div>
                <ul className={styles.list}>
                  {overview.topRefusalReasons.map((item) => (
                    <li key={`refusal-${item.label}`}>
                      <div className={styles.cardHeader}>
                        <strong>{item.label}</strong>
                        <span className={styles.badge}>{item.rate}%</span>
                      </div>
                      <p>{number(item.count)} 通</p>
                    </li>
                  ))}
                  {overview.riskDistribution.map((item) => (
                    <li key={`risk-${item.label}`}>
                      <div className={styles.cardHeader}>
                        <strong>风险 {item.label}</strong>
                        <span className={styles.badge}>{item.rate}%</span>
                      </div>
                      <p>{number(item.count)} 通</p>
                    </li>
                  ))}
                  {overview.topRefusalReasons.length === 0 && overview.riskDistribution.length === 0 ? (
                    <li><strong>暂无聚类</strong><p>完成更多通话分析后会出现分布。</p></li>
                  ) : null}
                </ul>
              </div>
            </section>

            <section className={styles.panel} style={{ marginTop: 16 }}>
              <div className={styles.panelHeader}>
                <h2>样本</h2>
                <span>{overview.samples.length}</span>
              </div>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>摘要</th>
                      <th>意图</th>
                      <th>结果</th>
                      <th>拒绝原因</th>
                      <th className={styles.numeric}>置信度</th>
                      <th>风险</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.samples.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.summary}</strong><small>{item.taskId}</small></td>
                        <td>{item.intent}</td>
                        <td>{item.outcome ?? '-'}</td>
                        <td>{item.refusalReason ?? '-'}</td>
                        <td className={styles.numeric}>{Math.round(item.confidence * 100)}%</td>
                        <td><span className={styles.badge}>{item.riskLevel}</span></td>
                      </tr>
                    ))}
                    {overview.samples.length === 0 ? <tr><td colSpan={6}>暂无通话分析样本</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={styles.panel} style={{ marginTop: 16 }}>
              <div className={styles.panelHeader}>
                <h2>低置信知识问题</h2>
                <span>{overview.lowConfidenceQuestions.length}</span>
              </div>
              <ul className={styles.list}>
                {overview.lowConfidenceQuestions.map((item) => (
                  <li key={item.label}>
                    <div className={styles.cardHeader}>
                      <strong>{item.label}</strong>
                      <span className={styles.badge}>{item.count}</span>
                    </div>
                    <p>占比 {item.rate}%</p>
                  </li>
                ))}
                {overview.lowConfidenceQuestions.length === 0 ? (
                  <li><strong>暂无低置信问题</strong><p>知识库检索日志没有低置信记录。</p></li>
                ) : null}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
