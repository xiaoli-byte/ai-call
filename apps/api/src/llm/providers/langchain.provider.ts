import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { ChatMessageLike } from '../llm.types.js';

/**
 * LangChain Provider：通过 ChatOpenAI 调用 OpenAI 兼容接口（DeepSeek/Qwen）。
 * 镜像 Python services/voice-agent/src/voice_agent/llm/langchain_adapter.py。
 */
export class LangChainProvider {
  constructor(private readonly model: ChatOpenAI) {}

  async invoke(
    messages: ChatMessageLike[],
    options: { temperature?: number } = {},
  ): Promise<string> {
    const lcMessages = messages.map((m) => {
      switch (m.role) {
        case 'system':
          return new SystemMessage(m.content);
        case 'assistant':
          return new AIMessage(m.content);
        case 'tool':
          return new ToolMessage({ content: m.content, tool_call_id: 'unknown' });
        default:
          return new HumanMessage(m.content);
      }
    });

    const kwargs: Record<string, unknown> = {};
    if (options.temperature !== undefined) {
      kwargs.temperature = options.temperature;
    }
    const result = await this.model.invoke(lcMessages, kwargs);
    if (result instanceof AIMessage) {
      return typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);
    }
    return String(result);
  }
}
