import { Copy, Play, Sparkles, Trash2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VoiceClone } from '@ai-call/shared';
import { formatBytes, formatDate, getModelLabel, getVoiceQuality } from './utils';

import styles from './voice-card.module.scss';

export function VoiceCard({
  clone,
  active,
  onPreview,
  onUse,
  onCopy,
  onDelete,
}: {
  clone: VoiceClone;
  active: boolean;
  onPreview: () => void;
  onUse: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const quality = getVoiceQuality(clone);

  return (
    <article className={cn(styles.card, active && styles.active)}>
      <div className={styles.header}>
        <div className={styles.avatar}>{clone.name.trim().slice(0, 1) || '音'}</div>
        <div className={styles.main}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{clone.name}</span>
            {quality >= 90 && <Sparkles size={13} />}
          </div>
          <span className={styles.id}>{clone.voiceId}</span>
          <span className={styles.meta}>
            {getModelLabel(clone.model)} · {formatBytes(clone.sourceFileSize)} · {formatDate(clone.createdAt)}
          </span>
        </div>
      </div>

      <div className={styles.quality}>
        <span className={styles.qualityTrack}>
          <span className={styles.qualityFill} style={{ width: `${quality}%` }} />
        </span>
        <strong className={styles.qualityValue}>{quality}%</strong>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.chipButton} onClick={onPreview}>
          <Play size={13} />
          试听
        </button>
        <button type="button" className={styles.useButton} onClick={onUse}>
          <Zap size={13} />
          使用此音色
        </button>
        <button type="button" className={styles.iconButton} title="复制音色 ID" onClick={onCopy}>
          <Copy size={14} />
        </button>
        <button type="button" className={cn(styles.iconButton, styles.danger)} title="删除" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}
