export interface BuiltInTtsVoice {
  id: string;
  description: string;
}

/**
 * Qwen TTS 内置音色。
 *
 * 场景配置与语音演示共用这份注册表，避免两个入口展示不同的音色集合。
 */
export const BUILT_IN_TTS_VOICES: readonly BuiltInTtsVoice[] = [
  { id: 'Cherry', description: '清晰自然' },
  { id: 'Serena', description: '温柔舒缓' },
  { id: 'Ethan', description: '沉稳自然' },
  { id: 'Chelsie', description: '明亮活力' },
];

export function isBuiltInTtsVoice(voice: string): boolean {
  return BUILT_IN_TTS_VOICES.some((item) => item.id === voice);
}
