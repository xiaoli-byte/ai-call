import type { ChatMessage } from '@ai-call/shared';

export interface ChatOptions {
  /** 系统提示词（追加为 role=system 消息） */
  systemPrompt?: string;
  /** 采样温度 */
  temperature?: number;
}

export interface ChatMessageLike {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export type { ChatMessage };
