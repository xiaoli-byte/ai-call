'use client';

import { useState } from 'react';
import { Bug } from 'lucide-react';
import { cn } from '@/lib/utils';

import styles from './call-detail-dialog.module.scss';

export type DebugRow = {
  label: string;
  value: string;
  copyable: boolean;
};

export function CallDetailDebugPanel({ rows }: { rows: DebugRow[] }) {
  const [collapsed, setCollapsed] = useState(true);

  const copy = (value: string) => {
    if (!value || value === '—') return;
    navigator.clipboard?.writeText(value).catch(() => {});
  };

  return (
    <div className={styles.debugPanel}>
      <button type="button" onClick={() => setCollapsed((value) => !value)}>
        <Bug size={13} />
        <span>调试信息</span>
        <i className={cn(styles.debugToggleIcon, !collapsed && styles.open)} />
      </button>
      {!collapsed && (
        <div className={styles.debugBody}>
          {rows.map((row) => (
            <div className={styles.debugRow} key={row.label}>
              <span>{row.label}</span>
              <code>{row.value}</code>
              {row.copyable && (
                <button type="button" onClick={() => copy(row.value)}>
                  复制
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
