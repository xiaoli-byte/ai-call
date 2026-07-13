'use client';

/**
 * useASR — 实时流式语音识别 Hook
 *
 * 通过 Python 后端的 /asr-stream 端点使用 WebRTC VAD + FunASR，
 * 前端仅采集麦克风音频并转发，VAD 和 ASR 均在服务端处理。
 *
 * 工作流程：
 *   start() → 连接 /asr-stream → 开启麦克风 → PCM 直发后端
 *           → 服务端 VAD + FunASR → partial/final/vad_state 回推
 *   stop()  → 断开 WebSocket → 关闭麦克风
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ASRStreamClient, type ASRConnectionState } from '@/lib/voice-agent-client';
import { voiceAgentWsBaseUrl } from '@/lib/voice-agent-ws';
import {
  TARGET_SAMPLE_RATE,
  createPCM16FrameBuffer,
  getPCM16FrameByteLength,
  type PCM16FrameBuffer,
} from '@/lib/audio-utils';
import { useAudioRecorder, type UseAudioRecorderOptions } from './useAudioRecorder';

/** ASR Hook 配置 */
export interface UseASROptions {
  /** Voice Agent WebSocket 基地址 */
  serverUrl?: string;
  /** 识别模式 */
  mode?: 'online' | 'offline' | '2pass';
  /** 热词 */
  hotwords?: string;
  /** 录音器选项（enableVAD 强制为 false，VAD 在服务端） */
  recorder?: UseAudioRecorderOptions;
}

/** ASR 识别记录 */
export interface ASRRecord {
  partial: string;
  finals: string[];
}

/** ASR 整体状态 */
export type ASRState = 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'error';

/** Hook 返回值 */
export interface UseASRReturn {
  state: ASRState;
  isListening: boolean;
  partialText: string;
  finalTexts: string[];
  error: string | null;
  audioLevel: number;
  isSpeaking: boolean;
  start: () => Promise<void>;
  stop: () => void;
  endSentence: () => void;
  clear: () => void;
}

const ASR_MODE = (process.env.NEXT_PUBLIC_FUNASR_MODE ?? '2pass') as 'online' | 'offline' | '2pass';
const ASR_HOTWORDS = process.env.NEXT_PUBLIC_FUNASR_HOTWORDS ?? '';
const ASR_FRAME_MS = 20;
const ASR_SEND_BATCH_MS = 200;
const ASR_FRAME_BYTES = getPCM16FrameByteLength(TARGET_SAMPLE_RATE, ASR_FRAME_MS);
const ASR_SEND_BATCH_BYTES = ASR_FRAME_BYTES * Math.max(1, Math.round(ASR_SEND_BATCH_MS / ASR_FRAME_MS));

export function useASR(options: UseASROptions = {}): UseASRReturn {
  // WS 前缀随页面协议派生（https→wss），不硬编码。
  const serverUrl = options.serverUrl ?? `${voiceAgentWsBaseUrl()}/asr-stream`;
  const mode = options.mode ?? ASR_MODE;
  const hotwords = options.hotwords ?? ASR_HOTWORDS;

  const [state, setState] = useState<ASRState>('idle');
  const [partialText, setPartialText] = useState('');
  const [finalTexts, setFinalTexts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const clientRef = useRef<ASRStreamClient | null>(null);
  const asrStateRef = useRef<ASRState>('idle');
  const audioBatchRef = useRef<PCM16FrameBuffer | null>(null);

  // VAD 在服务端，前端仅采集音频，不启用本地 VAD
  const recorder = useAudioRecorder({ ...options.recorder, enableVAD: false });

  const syncState = useCallback((s: ASRState) => {
    asrStateRef.current = s;
    setState(s);
  }, []);

  const handleResult = useCallback((result: { type: 'partial' | 'final'; text: string }) => {
    if (result.type === 'partial') {
      setPartialText(result.text);
    } else {
      setPartialText('');
      setFinalTexts((prev) => [...prev, result.text]);
    }
  }, []);

  const handleVadState = useCallback((speaking: boolean) => {
    setIsSpeaking(speaking);
  }, []);

  const flushPendingAudio = useCallback(() => {
    const client = clientRef.current;
    const audioBatch = audioBatchRef.current;
    if (!client || !audioBatch) return;

    const remaining = audioBatch.flush();
    if (remaining && remaining.byteLength > 0) {
      client.sendAudio(remaining);
    }
  }, []);

  const start = useCallback(async () => {
    if (asrStateRef.current !== 'idle' && asrStateRef.current !== 'error') return;

    setError(null);
    syncState('connecting');

    const client = new ASRStreamClient(
      { serverUrl, mode, hotwords },
      {
        onResult: handleResult,
        onVadState: handleVadState,
        onStatusChange: (connState: ASRConnectionState) => {
          if (connState === 'connected') {
            syncState('listening');
          } else if (connState === 'reconnecting') {
            syncState('reconnecting');
          } else if (connState === 'error') {
            syncState('error');
          } else if (connState === 'disconnected') {
            if (asrStateRef.current !== 'idle') {
              syncState('idle');
            }
          }
        },
        onError: (err: Error) => {
          setError(err.message);
        },
      },
    );
    clientRef.current = client;

    try {
      await client.connect();
    } catch (err) {
      setError((err as Error).message);
      syncState('error');
      return;
    }

    const audioBatch = createPCM16FrameBuffer(ASR_SEND_BATCH_BYTES);
    audioBatchRef.current = audioBatch;

    // 设置音频帧回调：按 20ms 对齐，批量发送 200ms 音频，降低 WS 消息频率。
    recorder.onAudioFrame((pcmData: ArrayBuffer) => {
      for (const batch of audioBatch.push(pcmData)) {
        client.sendAudio(batch);
      }
    });

    await recorder.start();

    if (recorder.error) {
      setError(recorder.error);
      syncState('error');
    }
  }, [serverUrl, mode, hotwords, handleResult, handleVadState, syncState, recorder]);

  const stop = useCallback(() => {
    flushPendingAudio();
    recorder.stop();
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    audioBatchRef.current = null;
    setIsSpeaking(false);
    syncState('idle');
  }, [flushPendingAudio, recorder, syncState]);

  const endSentence = useCallback(() => {
    flushPendingAudio();
    clientRef.current?.endSpeech();
  }, [flushPendingAudio]);

  const clear = useCallback(() => {
    setPartialText('');
    setFinalTexts([]);
  }, []);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        flushPendingAudio();
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      audioBatchRef.current = null;
    };
  }, [flushPendingAudio]);

  return {
    state,
    isListening: state === 'listening' || state === 'reconnecting',
    partialText,
    finalTexts,
    error,
    audioLevel: recorder.audioLevel,
    isSpeaking,
    start,
    stop,
    endSentence,
    clear,
  };
}
