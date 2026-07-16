'use client';

/**
 * DataTable —— 基于 TanStack Table 的无头表格封装。
 *
 * 设计约定（重要，勿破坏）：
 * - 公开 API 透传 TanStack 的标准 `ColumnDef` 约定，不发明私有 DSL：
 *   调用方只写 columns + data，排序/筛选/搜索逻辑全部由本组件统一接管。
 * - 渲染使用全局既有表格样式（.table-wrap > .table-scroll > table），
 *   视觉与手写表格完全一致，存量页面可逐张迁移、混排无差异。
 * - 排序：columnDef 默认可排序，列上 `enableSorting: false` 关闭；
 *   表头点击循环 升序 → 降序 → 还原，带 aria-sort 与指示符。
 * - 全局搜索：`globalFilter` 受控传入（搜索框仍由页面自绘，保持布局自由），
 *   默认 includesString 策略；列上 `enableGlobalFilter: false` 排除。
 * - 列筛选：`columnFilters` 受控传入（页面用自己的下拉/多选驱动）。
 */

import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table';

export type { ColumnDef, ColumnFiltersState, SortingState };

interface DataTableProps<TData> {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  /** 全局搜索词（受控）；命中任意未排除列即保留该行 */
  globalFilter?: string;
  /** 列筛选（受控），元素形如 { id: 列id, value: 筛选值 } */
  columnFilters?: ColumnFiltersState;
  /** 初始排序（非受控），如 [{ id: 'updatedAt', desc: true }] */
  initialSorting?: SortingState;
  /** 数据为空 / 筛选无结果时展示的文案 */
  emptyText?: string;
  onRowClick?: (row: TData) => void;
  /** 行 key 提取器；缺省用 TanStack row.id（行索引） */
  rowKey?: (row: TData) => string;
}

export function DataTable<TData>({
  columns,
  data,
  globalFilter,
  columnFilters,
  initialSorting = [],
  emptyText = '暂无数据',
  onRowClick,
  rowKey,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter: globalFilter ?? '',
      columnFilters: columnFilters ?? [],
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: 'includesString',
    getRowId: rowKey ? (row) => rowKey(row) : undefined,
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      onClick={
                        canSort
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                      style={canSort ? { cursor: 'pointer', userSelect: 'none' } : undefined}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {sorted === 'asc' && ' ↑'}
                      {sorted === 'desc' && ' ↓'}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center' }}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
