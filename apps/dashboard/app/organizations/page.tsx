import Link from 'next/link';
import { Building2, Database, KeyRound, Shield, Users } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { EmptyState } from '@/components/outbound/empty-state';

import styles from '../platform.module.scss';

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export default async function OrganizationsPage() {
  let overview: Awaited<ReturnType<typeof apiServer.platform.organizations>> | null = null;
  let error: string | null = null;
  try {
    overview = await apiServer.platform.organizations();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  const activeCount = overview?.organizations.filter((item) => item.status === 'active').length ?? 0;
  const providerCount = overview?.organizations.reduce((sum, item) => sum + item.providerCount, 0) ?? 0;
  const quotaCount = overview?.organizations.reduce((sum, item) => sum + item.quotaCount, 0) ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>组织管理</h1>
          <p>组织、Provider 配置、用量聚合、配额和当前数据隔离边界</p>
        </div>
        <Link href="/system/users" className={styles.primaryButton}>
          <Users size={15} />
          用户管理
        </Link>
      </header>

      <main className={styles.content}>
        {error || !overview ? (
          <EmptyState title="组织数据加载失败" description={error ?? '暂无数据'} />
        ) : (
          <>
            <section className={styles.statGrid}>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>组织数</span><Building2 size={16} /></div>
                <strong>{number(overview.organizations.length)}</strong>
                <small>活跃 {number(activeCount)}</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>Provider 配置</span><KeyRound size={16} /></div>
                <strong>{number(providerCount)}</strong>
                <small>组织级密钥引用</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>配额策略</span><Shield size={16} /></div>
                <strong>{number(quotaCount)}</strong>
                <small>日/月维度</small>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>默认租户</span><Database size={16} /></div>
                <strong>{overview.isolation.defaultTenantId}</strong>
                <small>承接旧业务数据</small>
              </article>
            </section>

            <section className={styles.layoutTwo}>
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>组织列表</h2>
                  <span>{new Date(overview.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                </div>
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>组织</th>
                        <th>状态</th>
                        <th>账务</th>
                        <th className={styles.numeric}>Provider</th>
                        <th className={styles.numeric}>配额</th>
                        <th>最近用量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.organizations.map((item) => (
                        <tr key={item.id}>
                          <td><strong>{item.name}</strong><small>{item.slug} · {item.id}</small></td>
                          <td><span className={styles.badge}>{item.status}</span></td>
                          <td>{item.billingStatus}</td>
                          <td className={styles.numeric}>{number(item.providerCount)}</td>
                          <td className={styles.numeric}>{number(item.quotaCount)}</td>
                          <td>
                            {item.usage[0] ? (
                              <span>{item.usage[0].metric}: {number(item.usage[0].quantity)}</span>
                            ) : (
                              <span className={styles.muted}>暂无</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {overview.organizations.length === 0 ? <tr><td colSpan={6}>暂无组织</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>隔离边界</h2>
                  <span>{overview.isolation.defaultTenantId}</span>
                </div>
                <ul className={styles.list}>
                  <li>
                    <strong>已覆盖</strong>
                    <p>{overview.isolation.coveredResources.join(' / ')}</p>
                  </li>
                  <li>
                    <strong>待迁移</strong>
                    <p>{overview.isolation.pendingResources.join(' / ')}</p>
                  </li>
                  <li>
                    <strong>说明</strong>
                    <p>{overview.isolation.note}</p>
                  </li>
                </ul>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
