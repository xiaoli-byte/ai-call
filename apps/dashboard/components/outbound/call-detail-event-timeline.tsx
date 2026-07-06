import { Activity } from 'lucide-react';
import type { CallEventRecord } from '@ai-call/shared';
import { cn } from '@/lib/utils';

import styles from './call-detail-dialog.module.scss';
import { formatEventTime, getEventLabel, getEventTone, summarizePayload } from './call-detail-utils';

export function CallDetailEventTimeline({ events }: { events: CallEventRecord[] }) {
  return (
    <section className={styles.eventTimeline} aria-label="通话事件时间线">
      <header className={styles.eventTimelineHeader}>
        <span><Activity size={13} />事件时间线</span>
        <b>{events.length} 个事件</b>
      </header>
      {events.length ? (
        <div className={styles.eventList}>
          {events.map((event) => (
            <article key={event.id} className={cn(styles.eventItem, styles[getEventTone(event.type)])}>
              <i className={styles.eventDot} />
              <time>{formatEventTime(event.createdAt)}</time>
              <strong>{getEventLabel(event.type)}</strong>
              <p>{summarizePayload(event.type, event.payload)}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.eventEmpty}>暂无事件记录</div>
      )}
    </section>
  );
}
