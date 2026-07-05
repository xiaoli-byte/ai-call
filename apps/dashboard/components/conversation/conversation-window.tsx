'use client';

import { useEffect, useRef } from 'react';
import styles from './conversation-window.module.scss';

export type ConversationRole = 'agent' | 'caller' | 'user' | 'action' | 'system';

export interface ConversationDebugItem {
  label: string;
  value: string;
}

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  text: string;
  label?: string;
  timestampLabel?: string;
  debug?: ConversationDebugItem[];
}

interface ConversationWindowProps {
  title?: string;
  subtitle?: string;
  badge?: string;
  messages: ConversationMessage[];
  emptyTitle?: string;
  emptyDescription?: string;
  showDebugInfo?: boolean;
  defaultDebugOpen?: boolean;
  variant?: 'card' | 'embedded';
  className?: string;
}

const ROLE_LABELS: Record<ConversationRole, string> = {
  agent: '坐席',
  caller: '客户',
  user: '用户',
  action: '动作',
  system: '系统',
};

export function ConversationWindow({
  title,
  subtitle,
  badge,
  messages,
  emptyTitle = '暂无对话',
  emptyDescription,
  showDebugInfo = false,
  defaultDebugOpen = false,
  variant = 'card',
  className,
}: ConversationWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const hasHeader = Boolean(title || subtitle || badge);
  const rootClassName = [
    styles.window,
    variant === 'embedded' ? styles.embedded : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <section className={rootClassName}>
      {hasHeader && (
        <div className={styles.header}>
          <div>
            {title && <div className={styles.title}>{title}</div>}
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          {badge && <span className={styles.badge}>{badge}</span>}
        </div>
      )}

      <div className={styles.messages}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <div>
              <div className={styles.emptyTitle}>{emptyTitle}</div>
              {emptyDescription && <div className={styles.emptyDesc}>{emptyDescription}</div>}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`${styles.message} ${styles[`message_${message.role}`]}`}
            >
              {message.role !== 'system' && (
                <div className={styles.meta}>
                  <span>{message.label ?? ROLE_LABELS[message.role]}</span>
                  {message.timestampLabel && <span>{message.timestampLabel}</span>}
                </div>
              )}
              <div className={styles.messageText}>{message.text}</div>
              {showDebugInfo && message.debug && message.debug.length > 0 && (
                <details className={styles.debugInfo} open={defaultDebugOpen}>
                  <summary>调试信息</summary>
                  <div className={styles.debugInfoBody}>
                    {message.debug.map((item) => (
                      <div className={styles.debugRow} key={`${message.id}-${item.label}`}>
                        <span className={styles.debugLabel}>{item.label}</span>
                        <span className={styles.debugValue}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </section>
  );
}
