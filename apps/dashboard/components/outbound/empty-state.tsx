import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

import styles from './empty-state.module.scss';

export function EmptyState({
  icon,
  title,
  description,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn(styles.empty, compact && styles.compact)}>
      {icon}
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  );
}
