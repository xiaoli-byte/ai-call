import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

import styles from './page-chrome.module.scss';

export function ScenarioPageTitle({
  title,
  breadcrumb,
  onBack,
  backLabel = '返回',
  extra,
}: {
  title: ReactNode;
  breadcrumb: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <div className={styles.pageTitle}>
      <button type="button" className={styles.backIcon} onClick={onBack} aria-label={backLabel}>
        <ArrowLeft size={22} />
      </button>
      <div className={styles.titleContent}>
        <h1>{title}</h1>
        <div className={styles.breadcrumb}>{breadcrumb}</div>
      </div>
      {extra && <div className={styles.titleExtra}>{extra}</div>}
    </div>
  );
}

export function ScenarioTabs({ children }: { children: ReactNode }) {
  return <div className={styles.tabs}>{children}</div>;
}

export function ScenarioTab({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button type="button" className={cn(styles.tab, active && styles.tabActive)} onClick={onClick}>
        {children}
      </button>
    );
  }

  return <span className={cn(styles.tab, active && styles.tabActive)}>{children}</span>;
}
