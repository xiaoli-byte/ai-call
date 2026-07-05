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
import { TaskStatus, type ScenarioKey } from '@ai-call/shared';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待执行',
  calling: '拨打中',
  in_call: '通话中',
  completed: '已完成',
  failed: '执行失败',
  no_answer: '未接听',
  cancelled: '已暂停',
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  pending: 'is-pending',
  calling: 'is-running',
  in_call: 'is-running',
  completed: 'is-completed',
  failed: 'is-failed',
  no_answer: 'is-paused',
  cancelled: 'is-paused',
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
  let scenarios: Awaited<ReturnType<typeof apiServer.scenarios.list>> = [];
  let error: string | null = null;

  try {
    [page, scenarios] = await Promise.all([
      apiServer.tasks.list({
        scenario: searchParams.scenario,
        status: searchParams.status,
        cursor: searchParams.cursor,
        limit: 50,
      }),
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
  const totalCalls = tasks.reduce((sum, task) => sum + Math.max(task.attemptCount, 1), 0);
  const connected = tasks.filter((task) => task.status === 'completed' || task.status === 'in_call').length;
  const failed = tasks.filter((task) => task.status === 'failed' || task.status === 'no_answer').length;
  const connectRate = totalCalls ? Math.round((connected / totalCalls) * 1000) / 10 : 0;

  return (
    <div className="outbound-page outbound-list-page">
      <header className="outbound-header">
        <div>
          <h1>外呼任务</h1>
          <p>管理和追踪所有外呼任务的执行情况</p>
        </div>
        <Link href="/tasks/new" className="outbound-primary-button">
          <Plus size={15} />
          新建任务
        </Link>
      </header>

      <main className="outbound-content">
        <section className="outbound-stat-grid" aria-label="任务统计">
          <article className="outbound-stat-card">
            <div className="outbound-stat-label"><span>本月任务总数</span><CalendarDays size={16} /></div>
            <strong>{number(tasks.length)}</strong>
            <small>当前列表任务</small>
            <p className="positive"><TrendingUp size={12} /> 实时同步任务数据</p>
          </article>
          <article className="outbound-stat-card">
            <div className="outbound-stat-label"><span>累计外呼量</span><PhoneCall size={16} /></div>
            <strong>{number(totalCalls)}</strong>
            <small>当前任务累计</small>
            <p className="positive"><TrendingUp size={12} /> 接通率 {connectRate}%</p>
          </article>
          <article className="outbound-stat-card">
            <div className="outbound-stat-label"><span>成功接通</span><CheckCircle2 size={16} /></div>
            <strong>{number(connected)}</strong>
            <small>已接通通话数</small>
            <p className="muted">失败或未接听 {number(failed)}</p>
          </article>
          <article className="outbound-stat-card">
            <div className="outbound-stat-label"><span>平均接通率</span><Activity size={16} /></div>
            <strong>{connectRate}%</strong>
            <small>当前列表均值</small>
            <p className="positive"><TrendingUp size={12} /> 数据持续更新</p>
          </article>
        </section>

        <section className="outbound-toolbar">
          <nav className="outbound-segments" aria-label="任务状态">
            {FILTERS.map((item) => (
              <Link
                key={item.label}
                href={filterHref(item.value, searchParams.query)}
                className={(searchParams.status ?? '') === item.value ? 'active' : ''}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="outbound-tools">
            <form className="outbound-search">
              {searchParams.status && <input type="hidden" name="status" value={searchParams.status} />}
              <Search size={14} />
              <input name="query" defaultValue={searchParams.query} placeholder="搜索任务名称或 ID..." />
            </form>
            <button type="button"><CalendarDays size={14} />日期筛选</button>
            <button type="button"><Download size={14} />导出</button>
          </div>
        </section>

        {error ? (
          <div className="outbound-empty"><strong>后端连接失败</strong><span>{error}</span></div>
        ) : tasks.length === 0 ? (
          <div className="outbound-empty"><PhoneCall size={24} /><strong>暂无外呼任务</strong><span>新建任务后会显示在这里</span></div>
        ) : (
          <div className="outbound-table-shell">
            <div className="outbound-table-scroll">
              <table className="outbound-table">
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
                          <Link href={`/tasks/${task.id}`} className="outbound-task-link">
                            <strong>{scenarioName}外呼任务</strong>
                            <span>{task.id}</span>
                          </Link>
                        </td>
                        <td><span className={`outbound-status ${STATUS_CLASS[task.status]}`}><i />{STATUS_LABELS[task.status]}</span></td>
                        <td><span className="outbound-robot"><PhoneCall size={13} />{scenarioName}</span></td>
                        <td className="numeric outbound-counts"><b>{number(attempts)}</b><span>/</span><em>{taskConnected}</em><span>/</span><i>{taskFailed}</i></td>
                        <td>
                          <div className="outbound-rate"><span><i style={{ width: `${Math.max(rate, 3)}%` }} /></span><b>{rate}%</b></div>
                        </td>
                        <td><div className="outbound-date"><span>{formatDate(task.scheduledAt)}</span>{task.duration ? <small>耗时 {task.duration}s</small> : null}</div></td>
                        <td className="outbound-creator">系统</td>
                        <td>
                          <Link href={`/tasks/${task.id}`} className="outbound-row-icon" aria-label={`查看 ${scenarioName} 外呼任务详情`}>
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
