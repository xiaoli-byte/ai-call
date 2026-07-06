import { cn } from '@/lib/utils';
import type { VoiceCloneModelOption } from './types';

import styles from './model-card.module.scss';

export function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: VoiceCloneModelOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(styles.card, selected && styles.selected)}
    >
      {model.badge && (
        <span className={cn(styles.badge, styles.badgePrimary)}>
          {model.badge}
        </span>
      )}
      <span className={styles.heading}>
        <span className={styles.radio}>
          {selected && <span />}
        </span>
        <strong>{model.name}</strong>
      </span>
      <span className={styles.description}>{model.description}</span>
      <span className={styles.tags}>
        {model.tags.map((tag) => (
          <span key={tag} className={styles.tag}>{tag}</span>
        ))}
      </span>
    </button>
  );
}
