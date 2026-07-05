'use client';

import useSWR, { unstable_serialize } from 'swr';
import { useSWRConfig } from 'swr';
import type {
  CreateVoiceCloneFields,
  CreateVoiceClonePreviewFields,
  SynthesizeVoiceCloneDto,
  VoiceClone,
} from '@ai-call/shared';
import { apiClient } from '@/lib/api/client';

export const VOICE_CLONES_KEY = ['voice-clones'] as const;
export const voiceClonesKeyString = () => unstable_serialize(VOICE_CLONES_KEY);

export function useVoiceClones(fallback?: VoiceClone[]) {
  return useSWR(VOICE_CLONES_KEY, () => apiClient.voiceClones.list(), {
    fallbackData: fallback,
  });
}

export function useVoiceCloneMutations() {
  const { mutate } = useSWRConfig();

  const refresh = async () => {
    await mutate(VOICE_CLONES_KEY);
  };

  return {
    create: async (fields: CreateVoiceCloneFields, audio: File) => {
      const clone = await apiClient.voiceClones.create(fields, audio);
      await refresh();
      return clone;
    },
    createPreview: async (fields: CreateVoiceClonePreviewFields, audio: File) => {
      return apiClient.voiceClones.createPreview(fields, audio);
    },
    synthesize: async (id: string, dto: SynthesizeVoiceCloneDto) => {
      const result = await apiClient.voiceClones.synthesize(id, dto);
      await refresh();
      return result;
    },
    confirm: async (id: string) => {
      const clone = await apiClient.voiceClones.confirm(id);
      await refresh();
      return clone;
    },
    remove: async (id: string) => {
      await apiClient.voiceClones.remove(id);
      await refresh();
    },
  };
}
