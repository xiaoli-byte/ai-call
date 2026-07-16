'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { FlowStatus, type TaskFlow } from '@ai-call/shared';
import { useTaskFlows } from '@/hooks/use-task-flows';
import { DataTable, type ColumnDef, type ColumnFiltersState } from '@/components/ui/data-table';
import { FlowRowActions } from './FlowRowActions';
import { NewFlowLink } from './NewFlowLink';
import { NewFlowEmptyLink } from './NewFlowEmptyLink';

const STATUS_LABELS: Record<FlowStatus, string> = {
  draft: '草稿',
  published: '已发布',
};

const STATUS_BADGE: Record<FlowStatus, string> = {
  draft: 'badge-neutral',
  published: 'badge-success',
};

/** 状态筛选下拉选项，空字符串代表“全部状态” */
const STATUS_FILTER_OPTIONS: Array<{ value: '' | FlowStatus; label: string }> = [
  { value: '', label: '全部状态' },
  { value: FlowStatus.DRAFT, label: '草稿' },
  { value: FlowStatus.PUBLISHED, label: '已发布' },
];

/** 场景筛选下拉的“未绑定场景”哨兵值，避免与真实 scenarioId 撞值 */
const UNBOUND_SCENARIO = '__unbound__';

/**
 * 列定义与组件状态无关，提到组件外部避免每次渲染重建。
 * 除“更新时间”外均关闭排序，与迁移前的交互保持一致（原页面只有更新时间可排序）。
 */
const columns: ColumnDef<TaskFlow, any>[] = [
  {
    accessorKey: 'name',
    header: '名称',
    enableSorting: false,
    // 不设置 enableGlobalFilter，默认参与全局搜索（对应原“按名称搜索流程”）
    cell: ({ row }) => {
      const f = row.original;
      return (
        <>
          <Link href={`/task-flows/${f.id}`} className="link-primary">
            {f.name}
          </Link>
          {f.description && (
            <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginTop: 2 }}>
              {f.description}
            </div>
          )}
        </>
      );
    },
  },
  {
    accessorKey: 'status',
    header: '状态',
    enableSorting: false,
    enableGlobalFilter: false,
    filterFn: 'equals',
    cell: ({ row }) => (
      <span className={`badge badge-dot ${STATUS_BADGE[row.original.status]}`}>
        {STATUS_LABELS[row.original.status]}
      </span>
    ),
  },
  {
    // 场景没有单一原始字段可直接 accessorKey，用 accessorFn 派生 scenarioId（未绑定则为空串）
    id: 'scenarioId',
    accessorFn: (f) => f.scenarioId ?? '',
    header: '场景',
    enableSorting: false,
    // 自定义 filterFn：兼容“未绑定场景”哨兵值语义，其余情况按 scenarioId 精确匹配
    filterFn: (row, columnId, filterValue) => {
      if (!filterValue) return true;
      const scenarioId = row.getValue<string>(columnId);
      if (filterValue === UNBOUND_SCENARIO) return !scenarioId;
      return scenarioId === filterValue;
    },
    cell: ({ row }) =>
      row.original.scenarioConfig ? (
        <span className="badge badge-info">{row.original.scenarioConfig.name}</span>
      ) : (
        <span className="badge badge-neutral">未绑定</span>
      ),
  },
  {
    accessorKey: 'version',
    header: '版本',
    enableSorting: false,
    cell: ({ row }) => (
      <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        v{row.original.version}
      </span>
    ),
  },
  {
    id: 'nodeCount',
    accessorFn: (f) => f.nodes.length,
    header: '节点数',
    enableSorting: false,
    cell: ({ row }) => (
      <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {row.original.nodes.length}
      </span>
    ),
  },
  {
    accessorKey: 'updatedAt',
    header: '更新时间',
    // 可排序（默认），表头点击即可切换升/降序，替代原来的独立排序下拉
    cell: ({ row }) => (
      <span style={{ color: 'var(--text-secondary)', fontSize: '12.5px' }}>
        {new Date(row.original.updatedAt).toLocaleString('zh-CN', { hour12: false })}
      </span>
    ),
  },
  {
    id: 'actions',
    header: () => <span style={{ display: 'block', textAlign: 'right' }}>操作</span>,
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row }) => {
      const f = row.original;
      return <FlowRowActions id={f.id} status={f.status} name={f.name} />;
    },
  },
];

/**
 * 外呼流程列表页
 *
 * 原实现是纯 Server Component（仅首屏拉取一次数据），无法承载名称搜索/状态筛选/
 * 场景筛选/排序/刷新这类需要客户端交互状态的能力，因此改为 Client Component，
 * 通过 useTaskFlows（SWR）拉取数据——与 scenarios、voice-clones 等列表页的既有写法保持一致。
 * 搜索/筛选/排序均为纯前端过滤（流程列表未做服务端分页，无需请求后端）。
 *
 * 表格渲染统一交给 DataTable（headless 封装，见 components/ui/data-table.tsx）：
 * 搜索框/筛选下拉仍由本页自绘，只是把结果以受控 globalFilter / columnFilters 喂给 DataTable，
 * 排序则改用表头点击（DataTable 原生能力），不再手写 useMemo 过滤/排序逻辑。
 */
export default function TaskFlowsPage() {
  const { data, error, isLoading, isValidating, mutate } = useTaskFlows();
  const flows = data ?? [];

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | FlowStatus>('');
  const [scenarioFilter, setScenarioFilter] = useState('');

  // 场景筛选下拉的选项：从当前流程列表里已绑定的场景去重派生，避免额外请求 scenarios 接口
  const scenarioOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of flows) {
      if (f.scenarioId && f.scenarioConfig) {
        seen.set(f.scenarioId, f.scenarioConfig.name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [flows]);

  // 受控列筛选：状态列、场景列各一个，仅在选中非“全部”时才附加对应条目
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const filters: ColumnFiltersState = [];
    if (statusFilter) filters.push({ id: 'status', value: statusFilter });
    if (scenarioFilter) filters.push({ id: 'scenarioId', value: scenarioFilter });
    return filters;
  }, [statusFilter, scenarioFilter]);

  const errorMessage = error ? (error instanceof Error ? error.message : '加载失败') : null;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">外呼流程</h1>
          <p className="subtitle">可视化编排外呼话术与动作流程</p>
        </div>
        <div className="page-actions">
          <NewFlowLink />
        </div>
      </div>

      {errorMessage ? (
        <div className="card">
          <div className="empty">
            <div className="empty-title" style={{ color: 'var(--danger)' }}>后端连接失败：{errorMessage}</div>
            <div className="empty-desc">请先启动后端：<code>cd apps/api && pnpm dev</code></div>
          </div>
        </div>
      ) : isLoading ? (
        <div className="card">
          <div className="empty">
            <div className="empty-title">流程加载中…</div>
          </div>
        </div>
      ) : flows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="15" y="15" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
              <path d="M6 9v3a3 3 0 0 0 3 3" />
              <path d="M15 12h-3a3 3 0 0 0-3 3" />
            </svg>
            <div className="empty-title">暂无流程配置</div>
            <div className="empty-desc">创建第一个可视化外呼流程</div>
            <NewFlowEmptyLink />
          </div>
        </div>
      ) : (
        <>
          <div className="filter-bar">
            <input
              className="form-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按名称搜索流程"
              aria-label="按名称搜索流程"
            />
            <select
              className="form-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as '' | FlowStatus)}
              aria-label="按状态筛选"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="form-select"
              value={scenarioFilter}
              onChange={(event) => setScenarioFilter(event.target.value)}
              aria-label="按绑定场景筛选"
            >
              <option value="">全部场景</option>
              <option value={UNBOUND_SCENARIO}>未绑定场景</option>
              {scenarioOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={() => void mutate()}
              disabled={isValidating}
              title="刷新"
              aria-label="刷新"
            >
              <RefreshCw size={15} />
            </button>
          </div>

          <DataTable
            columns={columns}
            data={flows}
            globalFilter={query}
            columnFilters={columnFilters}
            initialSorting={[{ id: 'updatedAt', desc: true }]}
            emptyText="暂无匹配流程，试试调整搜索关键字或筛选条件"
            rowKey={(f) => f.id}
          />
        </>
      )}
    </div>
  );
}
