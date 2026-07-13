export interface BuiltInTtsVoice {
  id: string;
  description: string;
  /** 音色人设描述，选中音色时写入 ttsConfig.voicePersona，注入 LLM 使话术语气与音色匹配。 */
  persona: string;
}

/**
 * Qwen TTS 内置音色。
 *
 * 场景配置与语音演示共用这份注册表，避免两个入口展示不同的音色集合。
 */
export const BUILT_IN_TTS_VOICES: readonly BuiltInTtsVoice[] = [
  { id: 'Cherry', description: '清晰自然', persona: '年轻女性声线，吐字清晰、语气自然干练，表达直接利落，适度使用礼貌用语。' },
  { id: 'Serena', description: '温柔舒缓', persona: '成熟女性声线，语气温柔耐心、节奏舒缓，多用安抚性和商量式的措辞。' },
  { id: 'Ethan', description: '沉稳自然', persona: '成熟男性声线，语气沉稳可靠、用词严谨专业，给人值得信赖的感觉。' },
  { id: 'Chelsie', description: '明亮活力', persona: '年轻女性声线，语气明快有活力、亲切热情，措辞轻松但不失分寸。' },
];

export function getBuiltInVoicePersona(voice: string): string {
  return BUILT_IN_TTS_VOICES.find((item) => item.id === voice)?.persona ?? '';
}

export function isBuiltInTtsVoice(voice: string): boolean {
  return BUILT_IN_TTS_VOICES.some((item) => item.id === voice);
}
