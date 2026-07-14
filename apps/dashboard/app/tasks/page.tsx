import Link from 'next/link';
import {
  Activity,
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  Download,
  PhoneCall,
  Plus,
  Search,
  TrendingUp,
} from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import { StatusBadge, type StatusTone } from '@/components/outbound/status-badge';
import { TaskStatus, type ScenarioKey } from '@ai-call/shared';
import { TaskListPoller } from './task-list-poller';

import styles from './tasks.module.scss';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待执行',
  calling: '拨打中',
  in_call: '通话中',
  completed: '已完成',
  failed: '执行失败',
  no_answer: '未接听',
  cancelled: '已暂停',
};

const STATUS_TONE: Record<TaskStatus, StatusTone> = {
  pending: 'pending',
  calling: 'running',
  in_call: 'running',
  completed: 'completed',
  failed: 'failed',
  no_answer: 'paused',
  cancelled: 'paused',
};

const FILTERS = [
  { label: '全部', value: '' },
  { label: '执行中', value: TaskStatus.CALLING },
  { label: '已完成', value: TaskStatus.COMPLETED },
  { label: '已暂停', value: TaskStatus.CANCELLED },
  { label: '失败', value: TaskStatus.FAILED },
] as const;

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function filterHref(status: string, query?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (query) params.set('query', query);
  const search = params.toString();
  return `/tasks${search ? `?${search}` : ''}`;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { scenario?: ScenarioKey; status?: TaskStatus; cursor?: string; query?: string };
}) {
  let page: Awaited<ReturnType<typeof apiServer.tasks.list>> = { items: [] };
  let summary: Awaited<ReturnType<typeof apiServer.tasks.summary>> = {
    currentMonthTasks: 0,
    totalAttempts: 0,
    connectedTasks: 0,
    failedTasks: 0,
    connectRate: 0,
  };
  let scenarios: Awaited<ReturnType<typeof apiServer.scenarios.list>> = [];
  let error: string | null = null;

  try {
    [page, summary, scenarios] = await Promise.all([
      apiServer.tasks.list({
        scenario: searchParams.scenario,
        status: searchParams.status,
        cursor: searchParams.cursor,
        limit: 50,
      }),
      apiServer.tasks.summary(),
      apiServer.scenarios.list(),
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '加载失败';
  }

  const scenarioNames = new Map(scenarios.map((item) => [item.scenario, item.name]));
  const query = searchParams.query?.trim().toLowerCase() ?? '';
  const tasks = page.items.filter((task) => {
    if (!query) return true;
    const scenarioName = scenarioNames.get(task.scenario) ?? task.scenario;
    return `${task.id} ${task.to} ${scenarioName}`.toLowerCase().includes(query);
  });
  return (
    <div className={cn('outbound-page', styles.page)}>
      <TaskListPoller />
      <header className={styles.header}>
        <div>
          <h1>外呼任务</h1>
          <p>管理和追踪所有外呼任务的执行情况</p>
        </div>
        <Link href="/tasks/new" className={styles.primaryButton}>
          <Plus size={15} />
          发起外呼
        </Link>
      </header>

      <main className={styles.content}>
        <section className={styles.statGrid} aria-label="任务统计">
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>本月任务总数</span><CalendarDays size={16} /></div>
            <strong>{number(summary.currentMonthTasks)}</strong>
            <small>当前列表任务</small>
            <p className={styles.positive}><TrendingUp size={12} /> 实时同步任务数据</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>累计外呼量</span><PhoneCall size={16} /></div>
            <strong>{number(summary.totalAttempts)}</strong>
            <small>当前任务累计</small>
            <p className={styles.positive}><TrendingUp size={12} /> 接通率 {summary.connectRate}%</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>成功接通</span><CheckCircle2 size={16} /></div>
            <strong>{number(summary.connectedTasks)}</strong>
            <small>已接通通话数</small>
            <p className={styles.muted}>失败或未接听 {number(summary.failedTasks)}</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>平均接通率</span><Activity size={16} /></div>
            <strong>{summary.connectRate}%</strong>
            <small>当前列表均值</small>
            <p className={styles.positive}><TrendingUp size={12} /> 数据持续更新</p>
          </article>
        </section>

        <section className={styles.toolbar}>
          <nav className={styles.segments} aria-label="任务状态">
            {FILTERS.map((item) => (
              <Link
                key={item.label}
                href={filterHref(item.value, searchParams.query)}
                className={(searchParams.status ?? '') === item.value ? styles.active : ''}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.tools}>
            <form className={styles.search}>
              {searchParams.status && <input type="hidden" name="status" value={searchParams.status} />}
              <Search size={14} />
              <input name="query" defaultValue={searchParams.query} placeholder="搜索任务名称或 ID..." />
            </form>
            <button type="button" className={styles.toolButton}><CalendarDays size={14} />日期筛选</button>
            <button type="button" className={styles.toolButton}><Download size={14} />导出</button>
          </div>
        </section>

        {error ? (
          <EmptyState title="后端连接失败" description={error} />
        ) : tasks.length === 0 ? (
          <EmptyState icon={<PhoneCall size={24} />} title="暂无外呼任务" description="新建任务后会显示在这里" />
        ) : (
          <div className={styles.tableShell}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>任务信息</th>
                    <th>状态</th>
                    <th>外呼机器人</th>
                    <th className="numeric">总量 / 接通 / 失败</th>
                    <th>接通率</th>
                    <th>开始时间</th>
                    <th>创建人</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const attempts = Math.max(task.attemptCount, 1);
                    const taskConnected = task.status === 'completed' || task.status === 'in_call' ? 1 : 0;
                    const taskFailed = task.status === 'failed' || task.status === 'no_answer' ? 1 : 0;
                    const rate = Math.round((taskConnected / attempts) * 100);
                    const scenarioName = scenarioNames.get(task.scenario) ?? task.scenario;
                    return (
                      <tr key={task.id}>
                        <td>
                          <Link href={`/tasks/${task.id}`} className={styles.taskLink}>
                            <strong>{scenarioName}外呼任务</strong>
                            <span>{task.id}</span>
                          </Link>
                        </td>
                        <td><StatusBadge tone={STATUS_TONE[task.status]}>{STATUS_LABELS[task.status]}</StatusBadge></td>
                        <td><span className={styles.robot}><PhoneCall size={13} />{scenarioName}</span></td>
                        <td className={cn(styles.numeric, styles.counts)}><b>{number(attempts)}</b><span>/</span><em>{taskConnected}</em><span>/</span><i>{taskFailed}</i></td>
                        <td>
                          <div className={styles.rate}><span><i style={{ width: `${Math.max(rate, 3)}%` }} /></span><b>{rate}%</b></div>
                        </td>
                        <td><div className={styles.date}><span>{formatDate(task.scheduledAt)}</span>{task.duration ? <small>耗时 {task.duration}s</small> : null}</div></td>
                        <td className={styles.creator}>系统</td>
                        <td>
                          <Link href={`/tasks/${task.id}`} className={styles.rowIcon} aria-label={`查看 ${scenarioName} 外呼任务详情`}>
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
