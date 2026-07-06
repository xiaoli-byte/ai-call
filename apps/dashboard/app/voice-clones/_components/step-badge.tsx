import styles from './step-badge.module.scss';

export function StepBadge({ n }: { n: number }) {
  return <span className={styles.badge}>{n}</span>;
}
