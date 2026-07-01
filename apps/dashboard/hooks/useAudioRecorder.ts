'use client';

/**
 * useAudioRecorder — 麦克风音频采集 Hook
 *
 * 职责：
 *   1. 通过 getUserMedia 获取麦克风音频流
 *   2. 使用 AudioWorkletNode 实时捕获音频帧
 *   3. 降采样到 16kHz 并转换为 16-bit PCM
 *   4. 基于能量阈值的 VAD（语音活动检测）
 *   5. 通过 onAudioFrame 回调输出 PCM 数据
 *
 * VAD 算法：
 *   - 计算每帧 RMS 能量
 *   - 能量 > threshold 持续 speechFrames 帧 → 标记为说话开始
 *   - 能量 < threshold 持续 silenceFrames 帧 → 标记为说话结束
 *   - 说话结束后触发 onSpeechEnd 回调（用于触发 ASR offline 识别）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TARGET_SAMPLE_RATE,
  floatTo16BitPCM,
  downsampleBuffer,
  calculateRMS,
  ensureAudioContext,
  registerAudioWorklet,
} from '@/lib/audio-utils';

/** VAD 配置 */
export interface VADConfig {
  /** 说话开始判定阈值（RMS 0.0~1.0），高于此值视为有声 */
  threshold: number;
  /** 说话结束判定阈值（RMS 0.0~1.0），低于此值视为静音，应小于 threshold 形成滞后区间 */
  silenceThreshold: number;
  /** 判定说话开始所需的连续有声帧数 */
  speechFrames: number;
  /** 判定说话结束所需的连续静音帧数 */
  silenceFrames: number;
}

/** 默认 VAD 参数 */
const DEFAULT_VAD: VADConfig = {
  threshold: 0.03,
  silenceThreshold: 0.015,
  speechFrames: 5, // 约 100ms（20ms/帧），过滤短促噪音
  silenceFrames: 15, // 约 300ms（20ms/帧）
};

/** 录音器状态 */
export type RecorderState = 'idle' | 'requesting' | 'recording' | 'error';

/** Hook 配置 */
export interface UseAudioRecorderOptions {
  /** VAD 配置 */
  vad?: Partial<VADConfig>;
  /** 是否启用 VAD（关闭则仅采集音频，不做语音检测） */
  enableVAD?: boolean;
}

/** Hook 返回值 */
export interface UseAudioRecorderReturn {
  /** 当前状态 */
  state: RecorderState;
  /** 是否正在录音 */
  isRecording: boolean;
  /** 当前音量级别（0.0~1.0） */
  audioLevel: number;
  /** 是否检测到语音活动 */
  isSpeaking: boolean;
  /** 错误信息 */
  error: string | null;
  /** 开始录音 */
  start: () => Promise<void>;
  /** 停止录音 */
  stop: () => void;
  /** 设置音频帧回调（携带当前 VAD 说话状态） */
  onAudioFrame: (callback: (pcmData: ArrayBuffer, isSpeaking: boolean) => void) => void;
  /** 设置语音开始回调（VAD 检测到说话开始时触发） */
  onSpeechStart: (callback: () => void) => void;
  /** 设置语音结束回调（VAD 检测到说话结束时触发） */
  onSpeechEnd: (callback: () => void) => void;
  /** 运行时更新 VAD 配置 */
  updateVADConfig: (patch: Partial<VADConfig>) => void;
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  // VAD 默认关闭：voice-demo 场景下 VAD 由 Python 后端处理，
  // 其他场景若需浏览器 VAD 可显式传 enableVAD=true
  const enableVAD = options.enableVAD ?? false;

  const [state, setState] = useState<RecorderState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const frameCallbackRef = useRef<(((pcm: ArrayBuffer, isSpeaking: boolean) => void)) | null>(null);
  const speechStartCallbackRef = useRef<((() => void) | null)>(null);
  const speechEndCallbackRef = useRef<((() => void) | null)>(null);

  // VAD 配置用 ref 存储，支持运行时动态修改
  const vadConfigRef = useRef<VADConfig>({ ...DEFAULT_VAD, ...options.vad });

  // VAD 状态
  const vadStateRef = useRef({
    speechFrameCount: 0,
    silenceFrameCount: 0,
    isSpeaking: false,
  });

  /** 运行时更新 VAD 配置 */
  const updateVADConfig = useCallback((patch: Partial<VADConfig>) => {
    vadConfigRef.current = { ...vadConfigRef.current, ...patch };
  }, []);

  /** 清理所有资源 */
  const cleanup = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    vadStateRef.current = { speechFrameCount: 0, silenceFrameCount: 0, isSpeaking: false };
    setAudioLevel(0);
    setIsSpeaking(false);
  }, []);

  /** 处理音频帧 */
  const handleAudioFrame = useCallback(
    (float32Data: Float32Array, sampleRate: number) => {
      // 降采样到 16kHz
      const downsampled = downsampleBuffer(float32Data, sampleRate, TARGET_SAMPLE_RATE);
      // 转为 PCM 16-bit
      const pcmBuffer = floatTo16BitPCM(downsampled);

      // VAD 处理（先于回调，确保回调拿到最新 isSpeaking 状态）
      if (enableVAD) {
        const rms = calculateRMS(downsampled);
        setAudioLevel(Math.min(rms * 3, 1)); // 放大显示

        const vad = vadStateRef.current;
        const cfg = vadConfigRef.current;

        if (vad.isSpeaking) {
          // 说话中：用更低的 silenceThreshold 判定结束（滞后区间防抖）
          if (rms < cfg.silenceThreshold) {
            vad.silenceFrameCount++;
            vad.speechFrameCount = 0;
            if (vad.silenceFrameCount >= cfg.silenceFrames) {
              vad.isSpeaking = false;
              setIsSpeaking(false);
              speechEndCallbackRef.current?.();
            }
          } else {
            vad.silenceFrameCount = 0;
          }
        } else {
          // 静音中：用较高的 threshold 判定说话开始
          if (rms > cfg.threshold) {
            vad.speechFrameCount++;
            vad.silenceFrameCount = 0;
            if (vad.speechFrameCount >= cfg.speechFrames) {
              vad.isSpeaking = true;
              setIsSpeaking(true);
              speechStartCallbackRef.current?.();
            }
          } else {
            vad.speechFrameCount = 0;
          }
        }
      }

      // 回调输出（携带当前 VAD 状态）
      frameCallbackRef.current?.(pcmBuffer, vadStateRef.current.isSpeaking);
    },
    [enableVAD],
  );

  /** 开始录音 */
  const start = useCallback(async () => {
    if (state === 'recording' || state === 'requesting') return;

    setError(null);
    setState('requesting');

    try {
      // 1. 获取麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // 2. 创建 AudioContext
      const ctx = await ensureAudioContext();
      audioContextRef.current = ctx;

      // 3. 注册 AudioWorklet
      await registerAudioWorklet(ctx);

      // 4. 连接音频图
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const workletNode = new AudioWorkletNode(ctx, 'recorder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event: MessageEvent) => {
        const float32Data = event.data as Float32Array;
        handleAudioFrame(float32Data, ctx.sampleRate);
      };

      source.connect(workletNode);

      setState('recording');
    } catch (err) {
      const msg = (err as Error).name === 'NotAllowedError'
        ? '麦克风权限被拒绝，请在浏览器设置中允许访问'
        : `麦克风启动失败: ${(err as Error).message}`;
      setError(msg);
      setState('error');
      cleanup();
    }
  }, [state, handleAudioFrame, cleanup]);

  /** 停止录音 */
  const stop = useCallback(() => {
    cleanup();
    setState('idle');
  }, [cleanup]);

  /** 设置音频帧回调（携带当前 VAD 说话状态） */
  const onAudioFrame = useCallback((callback: (pcmData: ArrayBuffer, isSpeaking: boolean) => void) => {
    frameCallbackRef.current = callback;
  }, []);

  /** 设置语音开始回调 */
  const onSpeechStart = useCallback((callback: () => void) => {
    speechStartCallbackRef.current = callback;
  }, []);

  /** 设置语音结束回调 */
  const onSpeechEnd = useCallback((callback: () => void) => {
    speechEndCallbackRef.current = callback;
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    state,
    isRecording: state === 'recording',
    audioLevel,
    isSpeaking,
    error,
    start,
    stop,
    onAudioFrame,
    onSpeechStart,
    onSpeechEnd,
    updateVADConfig,
  };
}
