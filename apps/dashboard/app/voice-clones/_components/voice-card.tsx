import { Copy, Play, Sparkles, Trash2, Zap } from 'lucide-react';
import type { VoiceClone } from '@ai-call/shared';
import { formatBytes, formatDate, getModelLabel, getVoiceQuality } from './utils';

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
    <article className={`voice-clone-item ${active ? 'active' : ''}`}>
      <div className="voice-clone-item-header">
        <div className="voice-clone-avatar">{clone.name.trim().slice(0, 1) || '音'}</div>
        <div className="voice-clone-item-main">
          <div className="voice-clone-item-name-row">
            <span className="voice-clone-item-name">{clone.name}</span>
            {quality >= 90 && <Sparkles size={13} />}
          </div>
          <span className="voice-clone-item-id">{clone.voiceId}</span>
          <span className="voice-clone-item-meta">
            {getModelLabel(clone.model)} · {formatBytes(clone.sourceFileSize)} · {formatDate(clone.createdAt)}
          </span>
        </div>
      </div>

      <div className="voice-clone-quality">
        <span>
          <span style={{ width: `${quality}%` }} />
        </span>
        <strong>{quality}%</strong>
      </div>

      <div className="voice-clone-item-actions">
        <button type="button" className="voice-clone-chip-button" onClick={onPreview}>
          <Play size={13} />
          试听
        </button>
        <button type="button" className="voice-clone-use-button" onClick={onUse}>
          <Zap size={13} />
          使用此音色
        </button>
        <button type="button" className="voice-clone-icon-button" title="复制音色 ID" onClick={onCopy}>
          <Copy size={14} />
        </button>
        <button type="button" className="voice-clone-icon-button danger" title="删除" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}
