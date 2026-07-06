import Link from 'next/link';
import { Clock, FileText, ListChecks, ShieldCheck } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';

import styles from '../tasks/tasks.module.scss';

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default async function CompliancePage() {
  let policy: Awaited<ReturnType<typeof apiServer.compliance.getPolicy>> | null = null;
  let logs: Awaited<ReturnType<typeof apiServer.compliance.listAuditLogs>> = [];
  let error: string | null = null;
  try {
    [policy, logs] = await Promise.all([
      apiServer.compliance.getPolicy(),
      apiServer.compliance.listAuditLogs({ limit: 20 }),
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <h1>合规中心</h1>
          <p>集中查看外呼时间窗、频控、黑白名单、AI 身份披露和审计日志</p>
        </div>
        <Link href="/global-config" className={styles.primaryButton}>
          <ListChecks size={15} />
          编辑规则
        </Link>
      </header>

      <main className={styles.content}>
        {error || !policy ? (
          <EmptyState title="合规配置加载失败" description={error ?? '暂无配置'} />
        ) : (
          <>
            <section className={styles.statGrid}>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>外呼时间窗</span><Clock size={16} /></div>
                <strong style={{ fontFamily: 'inherit', fontSize: 18 }}>{policy.callWindow.startTime}-{policy.callWindow.endTime}</strong>
                <small>{policy.callWindow.weekdaysOnly ? '仅工作日' : '每日可拨'} · {policy.callWindow.nonHolidayOnly ? '排除节假日' : '不排除节假日'}</small>
                <p className={styles.muted}>拨打前自动校验</p>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>每日频控</span><PhoneIcon /></div>
                <strong>{policy.dailyCallLimitPerCallee}</strong>
                <small>单号码每日拨打上限</small>
                <p className={styles.muted}>最大尝试 {policy.maxAttemptsPerNumber ?? policy.dailyCallLimitPerCallee}</p>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>黑名单</span><ShieldCheck size={16} /></div>
                <strong>{policy.blockedNumberCount}</strong>
                <small>命中后禁止外呼</small>
                <p className={styles.muted}>白名单 {policy.whitelistCount}</p>
              </article>
              <article className={styles.statCard}>
                <div className={styles.statLabel}><span>审计日志</span><FileText size={16} /></div>
                <strong>{logs.length}</strong>
                <small>最近配置与策略事件</small>
                <p className={styles.muted}>可追溯操作人</p>
              </article>
            </section>

            <div className={styles.tableShell} style={{ marginTop: 16 }}>
              <div style={{ padding: 16 }}>
                <div className={styles.statLabel}><span>AI 身份披露话术</span><ShieldCheck size={16} /></div>
                <p style={{ margin: '8px 0 0', color: '#0d1526', fontSize: 13, lineHeight: 1.7 }}>
                  {policy.aiDisclosureTemplate}
                </p>
              </div>
            </div>

            <div className={styles.tableShell} style={{ marginTop: 16 }}>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>事件</th>
                      <th>对象</th>
                      <th>操作人</th>
                      <th>说明</th>
                      <th>时间</th>
                      <th />
                      <th />
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>{log.action}</td>
                        <td>{log.subjectType ?? '-'} {log.subjectId ?? ''}</td>
                        <td>{log.actorName ?? log.actorId ?? '系统'}</td>
                        <td>{typeof log.details.reason === 'string' ? log.details.reason : '-'}</td>
                        <td>{formatDate(log.createdAt)}</td>
                        <td />
                        <td />
                        <td />
                      </tr>
                    ))}
                    {logs.length === 0 && <tr><td colSpan={8}>暂无审计日志</td></tr>}
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

function PhoneIcon() {
  return <span style={{ color: '#90a1b9', fontSize: 14 }}>#</span>;
}
