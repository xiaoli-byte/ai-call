import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import type { ChatMessage } from '@ai-call/shared';
import type { ChatOptions, ChatMessageLike } from './llm.types.js';
import { MockProvider } from './providers/mock.provider.js';
import { LangChainProvider } from './providers/langchain.provider.js';

/**
 * LLM 服务：按 LLM_PROVIDER 工厂化创建 provider，缺 key 降级 Mock。
 *
 * 镜像 Python services/voice-agent/src/voice_agent/llm/factory.py 的工厂模式。
 * 支持 deepseek / qwen / mock。testFlow 等后端场景通过本服务调用 LLM。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly provider: MockProvider | LangChainProvider;

  constructor() {
    const providerName = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
    const provider = this.createProvider(providerName);
    this.provider = provider;
    this.logger.log(`LLM provider initialized: ${providerName} (${this.provider.constructor.name})`);
  }

  private createProvider(name: string): MockProvider | LangChainProvider {
    if (name === 'deepseek') {
      const apiKey =
        process.env.LLM_DEEPSEEK_API_KEY ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.LLM_API_KEY;
      if (!apiKey) {
        this.logger.warn('DeepSeek API key 未配置，降级到 MockProvider');
        return new MockProvider();
      }
      const model = new ChatOpenAI(
        {
          apiKey,
          model: process.env.LLM_DEEPSEEK_MODEL ?? 'deepseek-chat',
          configuration: {
            baseURL: process.env.LLM_DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
          },
        } as never,
      );
      return new LangChainProvider(model);
    }

    if (name === 'qwen') {
      const apiKey = process.env.LLM_QWEN_API_KEY || process.env.LLM_API_KEY;
      if (!apiKey) {
        this.logger.warn('Qwen API key 未配置，降级到 MockProvider');
        return new MockProvider();
      }
      const model = new ChatOpenAI(
        {
          apiKey,
          model: process.env.LLM_QWEN_MODEL ?? 'qwen-plus',
          configuration: {
            baseURL:
              process.env.LLM_QWEN_BASE_URL ??
              'https://dashscope.aliyuncs.com/compatible-mode/v1',
          },
        } as never,
      );
      return new LangChainProvider(model);
    }

    if (name !== 'mock') {
      this.logger.warn(`未知 LLM_PROVIDER=${name}，降级到 MockProvider`);
    }
    return new MockProvider();
  }

  /**
   * 调用 LLM 返回文本回复。
   * @param messages 对话消息列表
   * @param options.systemPrompt 追加为 role=system 消息（若未在 messages 中）
   * @param options.temperature 采样温度
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const msgs: ChatMessageLike[] = [];
    if (options.systemPrompt) {
      msgs.push({ role: 'system', content: options.systemPrompt });
    }
    for (const m of messages) {
      msgs.push({ role: m.role, content: m.content });
    }
    if (msgs.length === 0) {
      return '';
    }
    return this.provider.invoke(msgs, { temperature: options.temperature });
  }
}
