import Link from 'next/link';
import { ArrowRight, Lightbulb } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { EmptyState } from '@/components/outbound/empty-state';

import styles from '../platform.module.scss';

export default async function InsightsPage() {
  let overview: Awaited<ReturnType<typeof apiServer.platform.datasets>> | null = null;
  let error: string | null = null;
  try {
    overview = await apiServer.platform.datasets();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>数据洞察</h1>
          <p>从通话分析、知识检索和风险分布中沉淀脚本、知识库、流程和合规优化方向</p>
        </div>
        <Link href="/datasets" className={styles.primaryButton}>
          <ArrowRight size={15} />
          样本数据
        </Link>
      </header>

      <main className={styles.content}>
        {error || !overview ? (
          <EmptyState title="洞察加载失败" description={error ?? '暂无数据'} />
        ) : (
          <section className={styles.templateGrid}>
            {overview.suggestions.map((item) => (
              <article key={item.id} className={styles.templateCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2>{item.title}</h2>
                    <p>{item.targetModule}</p>
                  </div>
                  <span className={styles.badge}>{item.priority}</span>
                </div>
                <p>{item.description}</p>
                <div className={styles.cardFooter}>
                  <span className={styles.muted}>{item.evidence}</span>
                  <Lightbulb size={16} />
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
