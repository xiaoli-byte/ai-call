'use client';

/**
 * StatusBadge — 连接状态指示器
 *
 * 根据 ASR/TTS 服务的连接状态显示对应的状态标签。
 */

import type { ASRState } from '@/hooks/useASR';
import type { TTSState } from '@/hooks/useTTS';

type Status = ASRState | TTSState;

interface StatusBadgeProps {
  label: string;
  status: Status;
}

const STATUS_MAP: Record<string, { text: string; className: string }> = {
  idle: { text: '空闲', className: 'badge-dim' },
  connecting: { text: '连接中', className: 'badge-warning' },
  listening: { text: '监听中', className: 'badge-success' },
  reconnecting: { text: '重连中', className: 'badge-warning' },
  synthesizing: { text: '合成中', className: 'badge-info' },
  playing: { text: '播放中', className: 'badge-success' },
  error: { text: '错误', className: 'badge-danger' },
};

export function StatusBadge({ label, status }: StatusBadgeProps) {
  const info = STATUS_MAP[status] ?? STATUS_MAP.idle;
  return (
    <span className="status-badge">
      <span className="status-label">{label}</span>
      <span className={`badge ${info.className}`}>{info.text}</span>
    </span>
  );
}
