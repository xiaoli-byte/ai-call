import type { VoiceClone } from '@ai-call/shared';
import { concatenateBuffers, TARGET_SAMPLE_RATE } from '@/lib/audio-utils';
import { MODEL_OPTIONS } from './constants';

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(value?: string) {
  return value ? new Date(value).toLocaleDateString('zh-CN', { hour12: false }) : '-';
}

export function withCacheBust(url: string | undefined, token: string | undefined) {
  if (!url) return undefined;
  const separator = url.includes('?') ? '&' : '?';
  return token ? `${url}${separator}t=${encodeURIComponent(token)}` : url;
}

export function buildWavFile(frames: ArrayBuffer[]) {
  const pcm = concatenateBuffers(frames);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  return new File([header, pcm], `voice-clone-${Date.now()}.wav`, { type: 'audio/wav' });
}

export function getModelLabel(model: string) {
  return MODEL_OPTIONS.find((item) => item.id === model)?.name ?? model;
}

export function getVoiceQuality(clone: VoiceClone) {
  const seed = `${clone.id}${clone.voiceId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i) * (i + 3)) % 997;
  return 86 + (hash % 12);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
