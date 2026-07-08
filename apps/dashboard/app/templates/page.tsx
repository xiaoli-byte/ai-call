import Link from 'next/link';
import { Blocks, BookOpen, ShieldCheck } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { EmptyState } from '@/components/outbound/empty-state';
import { CloneTemplateButton } from './CloneTemplateButton';

import styles from '../platform.module.scss';

export default async function TemplatesPage() {
  let templates: Awaited<ReturnType<typeof apiServer.platform.templates>> = [];
  let error: string | null = null;
  try {
    templates = await apiServer.platform.templates();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>模板中心</h1>
          <p>行业场景、流程图、知识结构、质检规则和指标建议</p>
        </div>
        <Link href="/task-flows/new" className={styles.secondaryButton}>
          <Blocks size={15} />
          空白流程
        </Link>
      </header>

      <main className={styles.content}>
        {error ? (
          <EmptyState title="模板加载失败" description={error} />
        ) : (
          <section className={styles.templateGrid}>
            {templates.map((template) => (
              <article key={template.id} className={styles.templateCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2>{template.name}</h2>
                    <p>{template.industry} · {template.complexity}</p>
                  </div>
                  <span className={styles.badge}>{template.nodes.length} 节点</span>
                </div>
                <p>{template.description}</p>
                <div className={styles.chips}>
                  {template.recommendedProviders.map((provider) => (
                    <span key={provider} className={styles.badge}>{provider}</span>
                  ))}
                </div>
                <div className={styles.layoutTwo} style={{ gridTemplateColumns: '1fr 1fr', marginTop: 0 }}>
                  <div>
                    <div className={styles.cardHeader}>
                      <strong><BookOpen size={13} /> 知识结构</strong>
                    </div>
                    <p>{template.knowledgeSchema.join(' / ')}</p>
                  </div>
                  <div>
                    <div className={styles.cardHeader}>
                      <strong><ShieldCheck size={13} /> 质检规则</strong>
                    </div>
                    <p>{template.qualityRules.join(' / ')}</p>
                  </div>
                </div>
                <div>
                  <strong>指标</strong>
                  <p>{template.successMetrics.join(' / ')}</p>
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.muted}>{template.scenarioKey}</span>
                  <CloneTemplateButton templateId={template.id} />
                </div>
              </article>
            ))}
            {templates.length === 0 ? (
              <EmptyState title="暂无模板" description="模板中心还没有可用行业模板" />
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
