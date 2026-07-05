import { VoiceCloneModel } from '@ai-call/shared';
import type { VoiceCloneModelOption } from './types';

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export const DEFAULT_PREVIEW_TEXT = '您好，这里是客户满意度调研中心，感谢您选择我们的服务。请问是王先生吗？';

export const MODEL_OPTIONS: VoiceCloneModelOption[] = [
  {
    id: VoiceCloneModel.QWEN,
    name: 'Qwen TTS',
    badge: '推荐',
    description: '通过云端声音复刻接口上传参考音频创建专属 voice，再生成试听语音',
    tags: ['云端复刻', '参考音频', '稳定'],
  },
  {
    id: VoiceCloneModel.COSYVOICE,
    name: 'CosyVoice',
    badge: '',
    description: '使用提示录音作为参考音频生成试听，适合需要还原说话人音色的场景',
    tags: ['参考音频', '音色复刻'],
  },
];
