import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

import styles from './status-badge.module.scss';

export type StatusTone = 'pending' | 'running' | 'completed' | 'paused' | 'failed';

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(styles.status, styles[tone], className)}>
      <i />
      {children}
    </span>
  );
}
