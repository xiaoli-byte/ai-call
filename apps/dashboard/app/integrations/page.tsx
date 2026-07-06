import { Activity, PlugZap, Send, ShieldCheck } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import { StatusBadge } from '@/components/outbound/status-badge';
import { IntegrationActions } from './IntegrationActions';

import styles from '../tasks/tasks.module.scss';

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

export default async function IntegrationsPage() {
  let connectors: Awaited<ReturnType<typeof apiServer.integrations.list>> = [];
  let logs: Awaited<ReturnType<typeof apiServer.integrations.logs>> = { items: [] };
  let error: string | null = null;
  try {
    [connectors, logs] = await Promise.all([
      apiServer.integrations.list(),
      apiServer.integrations.logs({ limit: 50 }),
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  const enabled = connectors.filter((item) => item.enabled).length;
  const failed = logs.items.filter((item) => item.status === 'failed').length;

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <h1>集成中心</h1>
          <p>管理 CRM、短信、Webhook 和内部 API 连接器，并追踪工具调用。</p>
        </div>
      </header>

      <main className={styles.content}>
        <section className={styles.statGrid}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>连接器</span><PlugZap size={16} /></div>
            <strong>{connectors.length}</strong>
            <small>启用 {enabled}</small>
            <p className={styles.muted}>Webhook / CRM / SMS</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>调用日志</span><Activity size={16} /></div>
            <strong>{logs.items.length}</strong>
            <small>最近调用</small>
            <p className={styles.muted}>含测试调用</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>失败调用</span><ShieldCheck size={16} /></div>
            <strong>{failed}</strong>
            <small>需排查</small>
            <p className={failed ? styles.muted : styles.positive}>状态可追踪</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>样例测试</span><Send size={16} /></div>
            <strong>Mock</strong>
            <small>mock://crm/leads</small>
            <p className={styles.positive}>本地可用</p>
          </article>
        </section>

        <IntegrationActions defaultConnectorId={connectors[0]?.id} />

        {error ? (
          <EmptyState title="集成中心加载失败" description={error} />
        ) : (
          <>
            <div className={styles.tableShell}>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>连接器</th>
                      <th>类型</th>
                      <th>状态</th>
                      <th>Endpoint</th>
                      <th>鉴权</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connectors.map((item) => (
                      <tr key={item.id}>
                        <td><div className={styles.taskLink}><strong>{item.name}</strong><span>{item.id}</span></div></td>
                        <td>{item.type}</td>
                        <td><StatusBadge tone={item.enabled ? 'completed' : 'paused'}>{item.enabled ? '启用' : '停用'}</StatusBadge></td>
                        <td>{item.endpoint}</td>
                        <td>{item.authType}</td>
                        <td>{formatDate(item.updatedAt)}</td>
                      </tr>
                    ))}
                    {connectors.length === 0 ? (
                      <tr><td colSpan={6}><EmptyState title="暂无连接器" description="创建一个 mock 连接器即可测试调用日志。" /></td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.tableShell} style={{ marginTop: 16 }}>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>调用</th>
                      <th>状态</th>
                      <th>方法</th>
                      <th>耗时</th>
                      <th>错误</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.items.map((item) => (
                      <tr key={item.id}>
                        <td><div className={styles.taskLink}><strong>{item.connectorName ?? item.connectorId ?? '测试调用'}</strong><span>{item.endpoint}</span></div></td>
                        <td><StatusBadge tone={item.status === 'success' ? 'completed' : 'failed'}>{item.status}</StatusBadge></td>
                        <td>{item.method}</td>
                        <td>{item.durationMs}ms</td>
                        <td className={styles.creator}>{item.errorMessage ?? '-'}</td>
                        <td>{formatDate(item.createdAt)}</td>
                      </tr>
                    ))}
                    {logs.items.length === 0 ? (
                      <tr><td colSpan={6}><EmptyState title="暂无调用日志" description="执行连接器测试后会生成日志。" /></td></tr>
                    ) : null}
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
