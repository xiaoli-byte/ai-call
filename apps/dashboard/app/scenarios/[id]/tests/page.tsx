import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, AlertTriangle, ClipboardCheck, Route, Target } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import { StatusBadge } from '@/components/outbound/status-badge';
import { ScenarioTestRunner } from './ScenarioTestRunner';

import styles from '../../../tasks/tasks.module.scss';

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

export default async function ScenarioTestsPage({
  params,
}: {
  params: { id: string };
}) {
  let scenario: Awaited<ReturnType<typeof apiServer.scenarios.get>>;
  let runs: Awaited<ReturnType<typeof apiServer.scenarioTests.list>>;
  let flows: Awaited<ReturnType<typeof apiServer.taskFlows.list>> = [];
  try {
    [scenario, runs, flows] = await Promise.all([
      apiServer.scenarios.get(params.id),
      apiServer.scenarioTests.list(params.id),
      apiServer.taskFlows.list(),
    ]);
  } catch {
    notFound();
  }
  const flowOptions = flows
    .filter((flow) => !flow.scenarioId || flow.scenarioId === scenario.id || flow.scenarioId === scenario.scenario)
    .map((flow) => ({ id: flow.id, name: flow.name }));

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <Link href="/scenarios" className={styles.toolButton} style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} />
            返回场景
          </Link>
          <h1>{scenario.name} · 测试记录</h1>
          <p>发布前验证流程路径、知识命中和转人工风险。</p>
        </div>
      </header>

      <main className={styles.content}>
        <section className={styles.statGrid}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>测试记录</span><ClipboardCheck size={16} /></div>
            <strong>{runs.items.length}</strong>
            <small>最近 50 条</small>
            <p className={styles.muted}>含黄金测试集</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>通过率</span><Target size={16} /></div>
            <strong>{runs.passRate}%</strong>
            <small>pass / total</small>
            <p className={styles.positive}>发布前评分</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>黄金覆盖</span><Route size={16} /></div>
            <strong>{runs.goldenCoverage}%</strong>
            <small>关键用例覆盖</small>
            <p className={styles.muted}>Phase 2 指标</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>高风险项</span><AlertTriangle size={16} /></div>
            <strong>{runs.highRiskItems.length}</strong>
            <small>需发布前处理</small>
            <p className={runs.highRiskItems.length ? styles.muted : styles.positive}>自动识别</p>
          </article>
        </section>

        <ScenarioTestRunner scenarioKey={scenario.scenario} flowOptions={flowOptions} />

        {runs.items.length === 0 ? (
          <EmptyState title="暂无测试记录" description="运行文本模拟后会记录节点路径、知识命中和风险项。" />
        ) : (
          <div className={styles.tableShell}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>输入</th>
                    <th>结果</th>
                    <th>分数</th>
                    <th>节点路径</th>
                    <th>知识命中</th>
                    <th>风险项</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.items.map((run) => (
                    <tr key={run.id}>
                      <td><div className={styles.taskLink}><strong>{run.input}</strong><span>{run.expectedOutcome ?? '-'}</span></div></td>
                      <td><StatusBadge tone={run.result === 'pass' ? 'completed' : run.result === 'fail' ? 'failed' : 'paused'}>{run.result}</StatusBadge></td>
                      <td>{run.score}</td>
                      <td>{run.nodePath.join(' → ') || '-'}</td>
                      <td>{run.knowledgeHits.map((hit) => hit.source).join('，') || '-'}</td>
                      <td className={styles.creator}>{run.riskItems.join('，') || '-'}</td>
                      <td>{formatDate(run.createdAt)}</td>
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
