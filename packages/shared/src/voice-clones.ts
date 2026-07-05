export const VoiceCloneStatus = {
  PREVIEW: 'preview',
  READY: 'ready',
  FAILED: 'failed',
  DISABLED: 'disabled',
} as const;

export type VoiceCloneStatus = (typeof VoiceCloneStatus)[keyof typeof VoiceCloneStatus];

export const VoiceCloneModel = {
  QWEN: 'qwen',
  COSYVOICE: 'cosyvoice',
} as const;

export type VoiceCloneModel = (typeof VoiceCloneModel)[keyof typeof VoiceCloneModel] | string;

export interface VoiceClone {
  id: string;
  /** 可填写到 TTS voice/spk_id 的业务音色 ID。 */
  voiceId: string;
  name: string;
  model: VoiceCloneModel;
  description: string;
  status: VoiceCloneStatus;
  sourceFilename: string;
  sourceMimeType: string;
  sourceFileSize: number;
  sourceAudioUrl: string;
  previewText?: string;
  previewAudioUrl?: string;
  previewGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVoiceCloneFields {
  voiceId?: string;
  name: string;
  model?: VoiceCloneModel;
  promptText: string;
  description?: string;
}

export interface CreateVoiceClonePreviewFields {
  voiceId?: string;
  name: string;
  model?: VoiceCloneModel;
  previewText: string;
  description?: string;
}

export interface SynthesizeVoiceCloneDto {
  text: string;
  name?: string;
  model?: VoiceCloneModel;
  description?: string;
}

export interface VoiceCloneSynthesisResult {
  voiceClone: VoiceClone;
  usedFallback: boolean;
  message?: string;
}
