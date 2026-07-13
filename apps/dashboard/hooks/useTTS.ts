'use client';

/**
 * useTTS — 实时流式语音合成 Hook
 *
 * 通过 Python 后端的 /tts-stream 端点使用 Qwen-TTS Realtime 云端合成，
 * 前端接收流式 PCM 数据并通过 Web Audio API 边收边播。
 *
 * 播放策略：
 *   - 使用 AudioContext + AudioBufferSourceNode 播放 PCM 数据
 *   - 每个 PCM chunk 转为 AudioBuffer 后立即排入播放队列
 *   - 通过 nextPlayTime 确保音频无缝衔接
 *   - GainNode 控制音量
 *
 * 中断（barge-in）：
 *   - 调用 stop() 发送 {"type": "cancel"} 给后端
 *   - 同时停止所有播放中的音频
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { TTSStreamClient, type TTSConnectionState } from '@/lib/voice-agent-client';
import { voiceAgentWsBaseUrl } from '@/lib/voice-agent-ws';
import {
  ensureAudioContext,
  pcm16ToFloat32,
} from '@/lib/audio-utils';

/** TTS 状态 */
export type TTSState = 'idle' | 'synthesizing' | 'playing' | 'error';

/** 语音参数 */
export interface VoiceParams {
  /** 音量（0.0 ~ 1.0，1.0 = 最大） */
  volume: number;
  /** 说话人 ID（Qwen-TTS 系统音色） */
  speaker: string;
  /** 指令文本（可选，控制语气/情感，需 instruct 模型） */
  instructText?: string;
}

/** Hook 配置 */
export interface UseTTSOptions {
  /** Voice Agent WebSocket 基地址 */
  serverUrl?: string;
  /** 默认说话人 */
  defaultSpeaker?: string;
  /** 采样率（与服务端 target_sample_rate 一致，默认 16000） */
  sampleRate?: number;
  /** 初始语音参数 */
  voiceParams?: Partial<VoiceParams>;
}

/** Hook 返回值 */
export interface UseTTSReturn {
  state: TTSState;
  isBusy: boolean;
  error: string | null;
  voiceParams: VoiceParams;
  updateVoiceParams: (params: Partial<VoiceParams>) => void;
  speak: (
    text: string,
    overrides?: Partial<Pick<VoiceParams, 'speaker' | 'instructText'>>,
  ) => Promise<void>;
  stop: () => void;
}

const VOICE_AGENT_WS_TOKEN = process.env.NEXT_PUBLIC_VOICE_AGENT_WS_TOKEN;
const QWEN_TTS_SPEAKER = process.env.NEXT_PUBLIC_QWEN_TTS_VOICE ?? 'Cherry';
const TTS_SAMPLE_RATE = parseInt(process.env.NEXT_PUBLIC_TTS_SAMPLE_RATE ?? '16000', 10);

const DEFAULT_VOICE_PARAMS: VoiceParams = {
  volume: 1.0,
  speaker: QWEN_TTS_SPEAKER,
};

export function useTTS(options: UseTTSOptions = {}): UseTTSReturn {
  const serverUrl = options.serverUrl ?? buildTtsStreamUrl();
  const defaultSpeaker = options.defaultSpeaker ?? QWEN_TTS_SPEAKER;
  const sampleRate = options.sampleRate ?? TTS_SAMPLE_RATE;

  const [state, setState] = useState<TTSState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [voiceParams, setVoiceParams] = useState<VoiceParams>({
    ...DEFAULT_VOICE_PARAMS,
    speaker: defaultSpeaker,
    ...options.voiceParams,
  });

  const clientRef = useRef<TTSStreamClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef(0);
  const ttsStateRef = useRef<TTSState>('idle');
  const voiceParamsRef = useRef(voiceParams);

  useEffect(() => {
    voiceParamsRef.current = voiceParams;
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = voiceParams.volume;
    }
  }, [voiceParams]);

  const syncState = useCallback((s: TTSState) => {
    ttsStateRef.current = s;
    setState(s);
  }, []);

  const ensurePlaybackContext = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const ctx = await ensureAudioContext();
      const gain = ctx.createGain();
      gain.gain.value = voiceParamsRef.current.volume;
      gain.connect(ctx.destination);
      audioContextRef.current = ctx;
      gainNodeRef.current = gain;
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  }, []);

  const playChunk = useCallback(
    (pcmData: ArrayBuffer) => {
      const ctx = audioContextRef.current;
      const gain = gainNodeRef.current;
      if (!ctx || !gain || pcmData.byteLength === 0) return;

      const float32 = pcm16ToFloat32(pcmData);
      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gain);

      const now = ctx.currentTime;
      const startTime = Math.max(nextPlayTimeRef.current, now);
      source.start(startTime);

      nextPlayTimeRef.current = startTime + audioBuffer.duration;

      activeSourcesRef.current.push(source);
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
        if (activeSourcesRef.current.length === 0 && !clientRef.current?.isSynthesizing) {
          syncState('idle');
        }
      };
    },
    [sampleRate, syncState],
  );

  const stopAllPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // source 可能已自然结束
      }
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const speak = useCallback(
    async (
      text: string,
      overrides?: Partial<Pick<VoiceParams, 'speaker' | 'instructText'>>,
    ) => {
      if (!text.trim()) return;
      if (ttsStateRef.current === 'synthesizing' || ttsStateRef.current === 'playing') {
        stopAllPlayback();
        clientRef.current?.interrupt();
      }

      setError(null);

      // 创建客户端（每次合成新建，便于中断控制）
      const client = new TTSStreamClient(
        { serverUrl, sampleRate, timeout: 30000 },
        {
          onChunk: (chunk: { audio: ArrayBuffer; isFinal: boolean }) => {
            if (chunk.isFinal) {
              syncState(activeSourcesRef.current.length > 0 ? 'playing' : 'idle');
            } else {
              playChunk(chunk.audio);
              syncState('playing');
            }
          },
          onStatusChange: (connState: TTSConnectionState) => {
            if (connState === 'synthesizing') {
              syncState('synthesizing');
            } else if (connState === 'error') {
              syncState('error');
            }
          },
          onError: (err: Error) => {
            setError(err.message);
          },
        },
      );
      clientRef.current = client;

      await ensurePlaybackContext();

      const params = { ...voiceParamsRef.current, ...overrides };

      try {
        await client.synthesize(text, {
          speaker: params.speaker,
          instructText: params.instructText,
        });
      } catch (err) {
        setError((err as Error).message);
        syncState('error');
      }

      if (activeSourcesRef.current.length === 0) {
        syncState('idle');
      }
    },
    [serverUrl, sampleRate, ensurePlaybackContext, playChunk, stopAllPlayback, syncState],
  );

  const stop = useCallback(() => {
    clientRef.current?.interrupt();
    stopAllPlayback();
    syncState('idle');
  }, [stopAllPlayback, syncState]);

  const updateVoiceParams = useCallback((params: Partial<VoiceParams>) => {
    setVoiceParams((prev) => ({ ...prev, ...params }));
  }, []);

  useEffect(() => {
    return () => {
      stopAllPlayback();
      clientRef.current?.disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [stopAllPlayback]);

  return {
    state,
    isBusy: state === 'synthesizing' || state === 'playing',
    error,
    voiceParams,
    updateVoiceParams,
    speak,
    stop,
  };
}

function buildTtsStreamUrl(): string {
  // WS 前缀随页面协议派生（https→wss），不硬编码。
  const base = `${voiceAgentWsBaseUrl()}/tts-stream`;
  return VOICE_AGENT_WS_TOKEN
    ? `${base}?token=${encodeURIComponent(VOICE_AGENT_WS_TOKEN)}`
    : base;
}
