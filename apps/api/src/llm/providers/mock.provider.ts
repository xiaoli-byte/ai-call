import { Logger } from '@nestjs/common';
import type { ChatMessageLike } from '../llm.types.js';

/**
 * Mock Provider：API key 缺失时降级使用。
 * 返回固定回复，保证 testFlow 等场景零配置可跑。
 */
export class MockProvider {
  private readonly logger = new Logger(MockProvider.name);

  async invoke(messages: ChatMessageLike[]): Promise<string> {
    const last = messages[messages.length - 1];
    const preview = last?.content.slice(0, 30) ?? '';
    this.logger.debug(`mock invoke, last=${preview}`);
    return `（Mock LLM）已收到消息，但未配置真实 LLM API key。最后输入：${preview}`;
  }
}
