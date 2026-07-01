/**
 * AI Provider 抽象层类型定义
 *
 * 通过环境变量 STT_PROVIDER/LLM_PROVIDER/TTS_PROVIDER 切换：
 * - 开源本地：FunASR STT
 * - 国际栈：Deepgram + GPT-4o + Cartesia
 * - 国内栈：阿里云 ASR + DeepSeek + CosyVoice
 * - Mock：用于无 API key 时的本地开发
 */

// ---------------------------------------------------------------------------
// STT（语音识别）
// ---------------------------------------------------------------------------

/** STT 流式回调事件 */
export interface STTEvent {
  /**
   * partial: 用户正在说话，text 是中间结果（可能被后续 final 修正）
   * final:   检测到端点（用户说完），text 是整句最终结果
   */
  type: 'partial' | 'final';
  text: string;
}

// ---------------------------------------------------------------------------
// LLM（大语言模型）
// ---------------------------------------------------------------------------

/** LLM 流式回调事件 */
export interface LLMEvent {
  type: 'delta' | 'tool_call' | 'done';
  /** delta 类型的文本增量 */
  content?: string;
  /** tool_call 类型的工具调用（一次完整的调用，arguments 已是对象） */
  toolCall?: ToolCall;
}

// ---------------------------------------------------------------------------
// Function Calling 工具
// ---------------------------------------------------------------------------

/** Function Calling 工具定义（对应 OpenAI tools[].function） */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 格式的参数定义 */
  parameters: Record<string, unknown>;
}

/** 工具调用请求（项目内部模型，arguments 为对象） */
export interface ToolCall {
  id: string;
  name: string;
  /** 参数对象（发送给 OpenAI 前由适配器 JSON.stringify） */
  arguments: Record<string, unknown>;
}

/** 工具调用结果 */
export interface ToolResult {
  /** 对应的 ToolCall.id */
  toolCallId: string;
  /** 工具返回的数据 */
  result: unknown;
  /** 是否需要转人工 */
  shouldEscalate?: boolean;
}

// ---------------------------------------------------------------------------
// TTS（语音合成）
// ---------------------------------------------------------------------------

/** TTS 流式音频块 */
export interface TTSChunk {
  /** PCM 16-bit 音频 buffer */
  audio: Buffer;
  /** 采样率 */
  sampleRate: number;
  /** 是否最后一块 */
  isFinal: boolean;
}

// ---------------------------------------------------------------------------
// 通话会话
// ---------------------------------------------------------------------------

/** 通话会话上下文 */
export interface CallSession {
  /** 通话 ID（与 FreeSWITCH UUID / 后端 OutboundTask.id 关联） */
  callId: string;
  /** 业务场景 */
  scenario: string;
  /** 场景变量（用于填充话术模板） */
  variables: Record<string, string>;
  /** 对话历史 */
  messages: ChatMessage[];
  /** 可用工具 */
  tools: ToolDefinition[];
}

/**
 * 聊天消息（项目内部模型）
 *
 * 与 OpenAI Chat Completions 的差异由 LLM 适配器负责转换：
 * - assistant.tool_calls → OpenAI 的 message.tool_calls（arguments 会被 JSON.stringify）
 * - tool.toolCallId     → OpenAI 的 message.tool_call_id
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 发起工具调用时携带（role=assistant 且有 tool_calls 时 content 通常为空） */
  toolCalls?: ToolCall[];
  /** tool 角色消息：对应的 ToolCall.id */
  toolCallId?: string;
  /** tool 角色消息：工具名称 */
  name?: string;
}
