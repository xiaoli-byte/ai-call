'use client';

import { Download } from 'lucide-react';
import { escapeCell } from '@/lib/outbound/import-parser';

import styles from './tasks.module.scss';

/** 导出用的单行数据，由 page.tsx（Server Component）用已加载/已筛选的任务数据算好后传入。 */
export interface TaskExportRow {
  id: string;
  to: string;
  scenarioName: string;
  statusLabel: string;
  total: number;
  connected: number;
  failed: number;
  rate: number;
  scheduledAt: string;
  duration: number | null;
}

const CSV_HEADERS = [
  '任务ID',
  '客户号码',
  '外呼机器人',
  '状态',
  '总量',
  '接通',
  '失败',
  '接通率',
  '开始时间',
  '通话时长(秒)',
];

// UTF-8 BOM 字符（U+FEFF）。用 fromCharCode 构造，避免源码里出现不可见字符。
// Excel 打开不带 BOM 的 UTF-8 CSV 时中文表头会乱码，这里加上以兼容。
const UTF8_BOM = String.fromCharCode(0xfeff);

function toCsvRow(row: TaskExportRow): string {
  const cells = [
    row.id,
    row.to,
    row.scenarioName,
    row.statusLabel,
    String(row.total),
    String(row.connected),
    String(row.failed),
    `${row.rate}%`,
    row.scheduledAt,
    row.duration != null ? String(row.duration) : '',
  ];
  return cells.map((cell) => escapeCell(cell, ',')).join(',');
}

/**
 * “导出”按钮：把当前已加载/已筛选的任务列表导出为 CSV。
 *
 * page.tsx 是 Server Component，因此拆成独立的小型 Client Component
 * （同 ./new-task-link.tsx、./task-list-poller.tsx 的共置模式）；
 * 行数据由服务端算好通过 props 传入，点击时纯客户端生成文件下载，不发起网络请求。
 * 值按 RFC4180 转义（含逗号/引号/换行时加引号），并加 UTF-8 BOM 便于 Excel 打开。
 */
export function ExportTasksButton({ rows }: { rows: TaskExportRow[] }) {
  function handleExport() {
    const lines = [CSV_HEADERS.join(','), ...rows.map(toCsvRow)];
    const csvContent = `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const dateStamp = new Date().toISOString().slice(0, 10);
    anchor.download = `outbound-tasks-${dateStamp}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      className={styles.toolButton}
      title="导出当前筛选结果"
      onClick={handleExport}
    >
      <Download size={14} />
      导出
    </button>
  );
}
