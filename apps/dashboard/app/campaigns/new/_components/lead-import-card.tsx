'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  FileSpreadsheet,
  Pencil,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TaskPriority } from '@ai-call/shared';
import {
  detectDelimiter,
  extractHeaders,
  isSystemColumn,
  parseImportText,
  PRIORITY_LABELS,
  serializeImportRows,
  type ImportRow,
} from '@/lib/outbound/import-parser';

import styles from './lead-import-card.module.scss';

const PRIORITY_OPTIONS: TaskPriority[] = [TaskPriority.HIGH, TaskPriority.NORMAL, TaskPriority.LOW];

function humanFileSize(bytes: number) {
  if (!bytes || bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function priorityTone(priority?: TaskPriority) {
  if (priority === TaskPriority.HIGH) return 'high';
  if (priority === TaskPriority.LOW) return 'low';
  return 'normal';
}

type LeadImportCardProps = {
  listText: string;
  fileName: string;
  fileSize: number;
  onFileChange: (file: File) => void;
  onListTextChange: (next: string, options?: { keepFileName?: boolean }) => void;
};

export function LeadImportCard({
  listText,
  fileName,
  fileSize,
  onFileChange,
  onListTextChange,
}: LeadImportCardProps) {
  const [editRow, setEditRow] = useState<ImportRow | null>(null);

  const delimiter = useMemo(() => detectDelimiter(listText), [listText]);
  const headers = useMemo(() => extractHeaders(listText, delimiter), [listText, delimiter]);
  const rows = useMemo(() => parseImportText(listText), [listText]);
  const variableColumns = useMemo(
    () => headers.filter((header) => !isSystemColumn(header)),
    [headers],
  );

  function commitRows(nextRows: ImportRow[]) {
    const next = serializeImportRows(headers, nextRows, delimiter);
    onListTextChange(next, { keepFileName: false });
  }

  function handleReupload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/plain';
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) onFileChange(file);
    };
    input.click();
  }

  function handleDeleteRow(rowNumber: number) {
    const next = rows.filter((row) => row.rowNumber !== rowNumber);
    commitRows(next);
  }

  function handleSaveRow(updated: ImportRow) {
    if (!editRow) return;
    const next = rows.map((row) => (row.rowNumber === updated.rowNumber ? updated : row));
    commitRows(next);
    setEditRow(null);
  }

  const hasFile = Boolean(fileName);
  const rowCount = rows.length;

  return (
    <section className={cn('card', styles.card)}>
      <div className="card-header">
        <div>
          <div className="card-title">客户名单</div>
          <div className="card-subtitle">支持 CSV 格式文件，单次导入上限 50,000 条记录</div>
        </div>
        <FileSpreadsheet size={18} />
      </div>

      <div className={styles.uploaderRow}>
        {hasFile ? (
          <div className={styles.fileBadge}>
            <div className={styles.fileBadgeIcon}>
              <FileSpreadsheet size={20} />
              <span className={styles.fileBadgeExt}>CSV</span>
            </div>
            <div className={styles.fileBadgeMeta}>
              <strong>{fileName}</strong>
              <span>
                {humanFileSize(fileSize)} · 共 {rowCount} 行
              </span>
            </div>
            <div className={styles.uploaderActions}>
            <button type="button" className="btn btn-secondary" onClick={handleReupload}>
              <RefreshCw size={14} />
              重新上传
            </button>
          </div>
          </div>
        ) : (
          <label className={styles.uploadEmpty}>
            <UploadCloud size={20} />
            <span>点击或拖拽上传名单文件</span>
            <small>支持 .csv / .tsv 格式</small>
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFileChange(file);
                event.target.value = '';
              }}
            />
          </label>
        )}
      </div>

      <div className={styles.previewHeader}>
        <div className={styles.previewTitle}>
          <span>名单预览</span>
          {rowCount > 0 && <small>（共 {rowCount} 行）</small>}
        </div>
      </div>

      <div className={styles.tableShell}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colPhone}>号码</th>
                <th className={styles.colCustomer}>客户</th>
                {variableColumns.map((header) => (
                  <th key={header} title={header}>
                    {header}
                  </th>
                ))}
                <th className={styles.colOps} aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rowCount === 0 ? (
                <tr>
                  <td colSpan={4 + variableColumns.length + 1} className={styles.emptyRow}>
                    等待导入名单
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.rowNumber} className={row.errors.length > 0 ? styles.invalidRow : undefined}>
                    <td className={styles.colPhone}>{row.to || '-'}</td>
                    <td className={styles.colCustomer}>{row.name || row.variables.customerName || '-'}</td>
                    {variableColumns.map((header) => (
                      <td key={header} className={styles.muted}>
                        {row.variables[header] ?? '-'}
                      </td>
                    ))}
                    <td className={styles.colOps}>
                      <div className={styles.rowOps}>
                        <button type="button" className={styles.rowOp} onClick={() => setEditRow(row)}>
                          <Pencil size={12} />
                          编辑
                        </button>
                        <button
                          type="button"
                          className={cn(styles.rowOp, styles.rowOpDanger)}
                          onClick={() => handleDeleteRow(row.rowNumber)}
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EditLeadRowDialog
        open={Boolean(editRow)}
        row={editRow}
        variableColumns={variableColumns}
        onClose={() => setEditRow(null)}
        onSave={handleSaveRow}
      />
    </section>
  );
}

type EditLeadRowDialogProps = {
  open: boolean;
  row: ImportRow | null;
  variableColumns: string[];
  onClose: () => void;
  onSave: (row: ImportRow) => void;
};

function EditLeadRowDialog({ open, row, variableColumns, onClose, onSave }: EditLeadRowDialogProps) {
  const [form, setForm] = useState<EditLeadRowForm>(emptyEditForm);

  useEffect(() => {
    if (open && row) {
      setForm({
        to: row.to,
        name: row.name ?? '',
        scheduledAt: row.scheduledAt ?? '',
        priority: row.priority ?? TaskPriority.NORMAL,
        variables: { ...row.variables },
      });
    }
  }, [open, row]);

  if (!row) return null;

  const updateVariable = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, variables: { ...prev.variables, [key]: value } }));
  };

  const handleSave = () => {
    const trimmedTo = form.to.replace(/\s+/g, '');
    const errors: string[] = [];
    if (!/^\+?\d{3,15}$/.test(trimmedTo)) errors.push('号码格式不正确');
    if (form.scheduledAt && !normalizeDate(form.scheduledAt)) errors.push('执行时间无法识别');

    onSave({
      rowNumber: row.rowNumber,
      to: trimmedTo,
      name: form.name.trim() || undefined,
      scheduledAt: form.scheduledAt.trim() || undefined,
      scheduledAtIso: normalizeDate(form.scheduledAt),
      priority: form.priority,
      variables: Object.fromEntries(
        Object.entries(form.variables).map(([key, value]) => [key, value.trim()]),
      ),
      errors,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={styles.editDialog}>
        <DialogHeader>
          <DialogTitle>编辑客户信息</DialogTitle>
          <DialogDescription>修改该行名单的号码、时间和变量，确认后保存到列表。</DialogDescription>
        </DialogHeader>

        <div className={styles.formGrid}>
          <div className={styles.formField}>
            <label className={styles.formLabel}>
              <span>号码</span>
              <em className={styles.required}>*</em>
            </label>
            <Input
              value={form.to}
              onChange={(event) => setForm((prev) => ({ ...prev, to: event.target.value }))}
              placeholder="请输入手机号"
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>客户</label>
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="客户姓名"
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>
              <span>时间</span>
              <CalendarDays size={12} className={styles.fieldHintIcon} />
            </label>
            <Input
              value={form.scheduledAt}
              onChange={(event) => setForm((prev) => ({ ...prev, scheduledAt: event.target.value }))}
              placeholder="2026-07-04 20:00"
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>优先级</label>
            <Select
              value={form.priority}
              onValueChange={(value) => setForm((prev) => ({ ...prev, priority: value as TaskPriority }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {PRIORITY_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {variableColumns.length > 0 && (
          <div className={styles.variableSection}>
            <div className={styles.variableSectionTitle}>变量</div>
            <div className={styles.formGrid}>
              {variableColumns.map((column) => (
                <div key={column} className={styles.formField}>
                  <label className={styles.formLabel}>{column}</label>
                  <Input
                    value={form.variables[column] ?? ''}
                    onChange={(event) => updateVariable(column, event.target.value)}
                    placeholder={`请输入 ${column}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EditLeadRowForm = {
  to: string;
  name: string;
  scheduledAt: string;
  priority: TaskPriority;
  variables: Record<string, string>;
};

const emptyEditForm: EditLeadRowForm = {
  to: '',
  name: '',
  scheduledAt: '',
  priority: TaskPriority.NORMAL,
  variables: {},
};

function normalizeDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
