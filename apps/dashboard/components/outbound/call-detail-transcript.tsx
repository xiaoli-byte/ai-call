'use client';

import type { RefObject } from 'react';
import { Bot, Bug, MessageSquareText, UserRound } from 'lucide-react';
import type { CallHistoryDetail, TranscriptTurn } from '@ai-call/shared';
import { cn } from '@/lib/utils';

import { EmptyState } from './empty-state';
import styles from './call-detail-dialog.module.scss';
import { CallDetailDebugPanel } from './call-detail-debug-panel';
import { debugRows, formatDuration } from './call-detail-utils';

export function CallDetailTranscript({
  call,
  taskId,
  customerName,
  robotName,
  transcript,
  activeIndex,
  debugMode,
  activeRef,
  onSeek,
}: {
  call: CallHistoryDetail;
  taskId: string;
  customerName: string;
  robotName: string;
  transcript: TranscriptTurn[];
  activeIndex: number;
  debugMode: boolean;
  activeRef: RefObject<HTMLElement>;
  onSeek: (seconds: number) => void;
}) {
  return (
    <div className={styles.transcript}>
      {transcript.length ? transcript.map((turn, index) => {
        const isCaller = turn.role === 'caller';
        const isSystem = turn.role === 'system';
        const isActive = index === activeIndex;
        const isPast = activeIndex > -1 && index < activeIndex;
        return (
          <article
            key={turn.id ?? `${turn.timestamp}-${index}`}
            ref={isActive ? activeRef : null}
            className={cn(
              styles.turn,
              styles[turn.role],
              isActive && styles.active,
              isPast && styles.past,
            )}
            onClick={() => onSeek(turn.timestamp)}
            title={`跳转到 ${formatDuration(turn.timestamp)}`}
          >
            {!isCaller && <div className={styles.turnAvatar}>{isSystem ? <Bug size={13} /> : <Bot size={13} />}</div>}
            <div className={styles.turnContent}>
              {debugMode && <CallDetailDebugPanel rows={debugRows({ call, taskId, turn, index })} />}
              <div className={styles.turnMeta}>
                <span>{isCaller ? customerName : isSystem ? '系统' : robotName}</span>
                <time>{formatDuration(turn.timestamp)}</time>
              </div>
              <p className={styles.turnBubble}>{turn.content}</p>
            </div>
            {isCaller && (
              <div className={cn(styles.turnAvatar, styles.callerAvatar)}>
                <UserRound size={13} />
              </div>
            )}
          </article>
        );
      }) : (
        <EmptyState
          compact
          icon={<MessageSquareText size={20} />}
          title="暂无对话记录"
          description="通话转写完成后会显示在这里"
        />
      )}
    </div>
  );
}
