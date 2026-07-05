import type {
  CreateVoiceCloneFields,
  CreateVoiceClonePreviewFields,
  SynthesizeVoiceCloneDto,
  VoiceClone,
  VoiceCloneSynthesisResult,
} from '@ai-call/shared';
import type { HttpAdapter } from '../types';

export function voiceClonesEndpoints(http: HttpAdapter) {
  return {
    list: () => http.request<VoiceClone[]>('/voice-clones'),
    get: (id: string) => http.request<VoiceClone>(`/voice-clones/${id}`),
    create: (fields: CreateVoiceCloneFields, audio: File) => {
      const form = new FormData();
      if (fields.voiceId) form.set('voiceId', fields.voiceId);
      form.set('name', fields.name);
      form.set('model', fields.model ?? 'cosyvoice');
      form.set('promptText', fields.promptText);
      if (fields.description) form.set('description', fields.description);
      form.set('audio', audio);
      return http.request<VoiceClone>('/voice-clones', {
        method: 'POST',
        body: form,
      });
    },
    createPreview: (fields: CreateVoiceClonePreviewFields, audio: File) => {
      const form = new FormData();
      if (fields.voiceId) form.set('voiceId', fields.voiceId);
      form.set('name', fields.name);
      form.set('model', fields.model ?? 'cosyvoice');
      form.set('previewText', fields.previewText);
      if (fields.description) form.set('description', fields.description);
      form.set('audio', audio);
      return http.request<VoiceCloneSynthesisResult>('/voice-clones/preview', {
        method: 'POST',
        body: form,
      });
    },
    synthesize: (id: string, dto: SynthesizeVoiceCloneDto) =>
      http.request<VoiceCloneSynthesisResult>(`/voice-clones/${id}/synthesize`, {
        method: 'POST',
        body: dto,
      }),
    confirm: (id: string) =>
      http.request<VoiceClone>(`/voice-clones/${id}/confirm`, { method: 'POST' }),
    remove: (id: string) =>
      http.request<void>(`/voice-clones/${id}`, { method: 'DELETE' }),
  };
}
