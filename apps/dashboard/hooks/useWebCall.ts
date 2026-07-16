'use client';

/**
 * useWebCall — 首页浏览器模拟外呼 Hook
 *
 * 走真实业务管线（契约 §3/§4）：
 *   1. POST /web-demo/calls { flowId }（匿名公开端点：服务端建单锁定已发布 flowVersion
 *      并按 web 通道 dispatch）拿 taskId + attemptId；
 *   2. 申请麦克风（useAudioRecorder：AudioWorklet mono 采集 → 16k PCM16）；
 *   3. 连 `${NEXT_PUBLIC_VOICE_AGENT_WS_URL}/audio-stream`，首帧 metadata（dialog_id=attemptId）；
 *   4. 上行 20ms 帧聚批 ≤200ms 发送（对齐 useASR 节奏）；
 *      下行二进制帧 = 16k mono s16le 音频（AudioContext + nextPlayTime 排队播放，参照 useTTS）；
 *      文本帧 = 字幕/事件（agent_speech / caller_speech / end / error / clear_audio）；
 *      clear_audio（打断）= 清空已排队播放的下行音频（停所有音源、nextPlayTime 归零），
 *      不关闭 AudioContext、不改通话状态、不动字幕，后续下行音频照常排队播放。
 *
 * 状态机：idle → preparing（建单+dispatch）→ dialing（要麦克风/连 WS）→ in-call → ended | error。
 * hangup()：停采集、关 WS、停播放；组件卸载时清理全部资源。
 * AudioContext 由 startCall 调用链创建（必须由用户手势触发）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import {
  TARGET_SAMPLE_RATE,
  createPCM16FrameBuffer,
  ensureAudioContext,
  getPCM16FrameByteLength,
  pcm16ToFloat32,
  type PCM16FrameBuffer,
} from '@/lib/audio-utils';
import {
  WebCallClient,
  buildCallMetadata,
  type WebCallServerEvent,
} from '@/lib/web-call-client';

/** 上行节奏：20ms 帧、60ms 聚批 */
const FRAME_MS = 20;
// 60ms 聚批相比旧的 200ms 可减少最多 140ms 的打断延迟，同时 WebSocket 开销仍可控；
// 服务端会重新切成精确的 20ms VAD 帧，并自带 300ms 语音前置缓冲。
const SEND_BATCH_MS = 60;
const FRAME_BYTES = getPCM16FrameByteLength(TARGET_SAMPLE_RATE, FRAME_MS);
const SEND_BATCH_BYTES = FRAME_BYTES * Math.max(1, Math.round(SEND_BATCH_MS / FRAME_MS));

export type WebCallState = 'idle' | 'preparing' | 'dialing' | 'in-call' | 'ended' | 'error';

export interface WebCallSubtitle {
  id: number;
  role: 'agent' | 'caller';
  text: string;
}

export interface StartWebCallParams {
  /** 已发布流程 ID（服务端建单时锁定其已发布版本；被叫/通道由服务端强制） */
  flowId: string;
}

export interface UseWebCallReturn {
  state: WebCallState;
  subtitles: WebCallSubtitle[];
  /** 建单成功后即有值（真实落库的任务 ID，仅内部使用，不在首页展示） */
  taskId: string | null;
  /** 结束原因（end 帧 reason / hangup / disconnected） */
  endReason: string | null;
  error: string | null;
  startCall: (params: StartWebCallParams) => Promise<void>;
  /** 挂断：停采集、关 WS、停播放，置 ended */
  hangup: () => void;
  /** 回到 idle（再次拨打前重置） */
  reset: () => void;
}

export function useWebCall(): UseWebCallReturn {
  const [state, setState] = useState<WebCallState>('idle');
  const [subtitles, setSubtitles] = useState<WebCallSubtitle[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<WebCallState>('idle');
  const clientRef = useRef<WebCallClient | null>(null);
  const batchRef = useRef<PCM16FrameBuffer | null>(null);
  const subtitleSeqRef = useRef(0);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainingRef = useRef(false);

  // 播放链（参照 useTTS：AudioContext + nextPlayTime 无缝排队）
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef(0);

  const recorder = useAudioRecorder({ enableVAD: false });
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const syncState = useCallback((next: WebCallState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** 下行音频排队播放（16k mono s16le） */
  const playChunk = useCallback((pcm: ArrayBuffer) => {
    const ctx = playbackCtxRef.current;
    if (!ctx || pcm.byteLength === 0) return;

    const float32 = pcm16ToFloat32(pcm);
    const audioBuffer = ctx.createBuffer(1, float32.length, TARGET_SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startTime = Math.max(nextPlayTimeRef.current, ctx.currentTime);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + audioBuffer.duration;

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
    };
  }, []);

  const stopPlayback = useCallback(() => {
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

  const closePlaybackContext = useCallback(() => {
    const ctx = playbackCtxRef.current;
    playbackCtxRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  }, []);

  /** 释放通话资源：停采集、关 WS、停播放（不动 React 展示状态） */
  const releaseResources = useCallback(() => {
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    drainingRef.current = false;
    recorderRef.current.stop();
    batchRef.current?.clear();
    batchRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    client?.close();
    stopPlayback();
    closePlaybackContext();
  }, [stopPlayback, closePlaybackContext]);

  /** 走向终态 */
  const finishCall = useCallback(
    (final: 'ended' | 'error', reason?: string, message?: string) => {
      releaseResources();
      if (reason) setEndReason(reason);
      if (message) setError(message);
      syncState(final);
    },
    [releaseResources, syncState],
  );

  /**
   * 温和收尾（end 帧/服务端断开）：立即停采集、关 WS，但已入队的下行音频
   * 播完再释放播放链并置 ended——end 帧先于尾段音频播完到达，直接
   * finishCall 会把最后一句话术掐断。用户主动挂断与错误仍走 finishCall 即时切断。
   */
  const finishCallAfterPlayback = useCallback(
    (reason: string) => {
      if (drainingRef.current) return;
      drainingRef.current = true;

      recorderRef.current.stop();
      batchRef.current?.clear();
      batchRef.current = null;
      const client = clientRef.current;
      clientRef.current = null;
      client?.close();

      const ctx = playbackCtxRef.current;
      const remainingSec = ctx ? nextPlayTimeRef.current - ctx.currentTime : 0;
      const remainingMs = Number.isFinite(remainingSec) ? Math.max(0, remainingSec * 1000) : 0;
      const settle = () => {
        drainTimerRef.current = null;
        drainingRef.current = false;
        finishCall('ended', reason);
      };
      if (remainingMs <= 0) {
        settle();
      } else {
        drainTimerRef.current = setTimeout(settle, remainingMs + 150);
      }
    },
    [finishCall],
  );

  const appendSubtitle = useCallback((role: 'agent' | 'caller', text: string) => {
    if (!text) return;
    subtitleSeqRef.current += 1;
    const id = subtitleSeqRef.current;
    setSubtitles((prev) => [...prev, { id, role, text }]);
  }, []);

  const handleServerEvent = useCallback(
    (event: WebCallServerEvent) => {
      switch (event.type) {
        case 'agent_speech':
          appendSubtitle('agent', event.text);
          break;
        case 'caller_speech':
          appendSubtitle('caller', event.text);
          break;
        case 'end':
          finishCallAfterPlayback(event.reason ?? 'completed');
          break;
        case 'error':
          finishCall('error', 'error', event.message ?? '通话出现错误');
          break;
        case 'clear_audio':
          // 打断：清空已排队播放的下行音频，不关闭 AudioContext、不改通话状态、不动字幕；
          // nextPlayTime 归零后，后续下行音频从 currentTime 起继续正常排队播放。
          stopPlayback();
          break;
        default:
          break;
      }
    },
    [appendSubtitle, finishCall, finishCallAfterPlayback, stopPlayback],
  );

  const startCall = useCallback(
    async ({ flowId }: StartWebCallParams) => {
      if (
        stateRef.current === 'preparing' ||
        stateRef.current === 'dialing' ||
        stateRef.current === 'in-call'
      ) {
        return;
      }

      setError(null);
      setEndReason(null);
      setTaskId(null);
      setSubtitles([]);
      subtitleSeqRef.current = 0;
      syncState('preparing');

      try {
        // 1-2. 匿名公开端点一步完成：真实建单（锁定已发布 flowVersion）+ web 通道 dispatch
        const demoCall = await apiClient.webDemo.startCall(flowId);
        setTaskId(demoCall.taskId);
        const attemptId = demoCall.attemptId;
        if (!attemptId) {
          throw new Error('服务端未返回 attemptId，请确认 API 已支持 web 通道');
        }

        syncState('dialing');

        // 3. 播放上下文（用户手势调用链内创建）
        playbackCtxRef.current = await ensureAudioContext();
        nextPlayTimeRef.current = 0;

        // 4. 上行聚批缓冲 + 麦克风采集
        const batch = createPCM16FrameBuffer(SEND_BATCH_BYTES);
        batchRef.current = batch;
        recorderRef.current.onAudioFrame((pcm) => {
          for (const chunk of batch.push(pcm)) {
            clientRef.current?.sendAudio(chunk);
          }
        });
        await recorderRef.current.start();

        // 5. 连 WS，首帧 metadata（契约 §3）
        const client = new WebCallClient(
          { metadata: buildCallMetadata(attemptId) },
          {
            onAudio: playChunk,
            onEvent: handleServerEvent,
            onClose: () => {
              // 服务端先关（未收到 end/error 帧）→ 视为通话结束，已收到的音频播完再收尾
              if (stateRef.current === 'in-call' || stateRef.current === 'dialing') {
                finishCallAfterPlayback('disconnected');
              }
            },
            onError: () => {
              if (stateRef.current === 'in-call' || stateRef.current === 'dialing') {
                finishCall('error', 'error', '语音连接出现异常');
              }
            },
          },
        );
        clientRef.current = client;
        await client.connect();

        syncState('in-call');
      } catch (err) {
        const message = err instanceof Error ? err.message : '发起模拟外呼失败';
        finishCall('error', 'error', message);
      }
    },
    [syncState, playChunk, handleServerEvent, finishCall, finishCallAfterPlayback],
  );

  const hangup = useCallback(() => {
    if (stateRef.current === 'idle' || stateRef.current === 'ended' || stateRef.current === 'error') {
      return;
    }
    finishCall('ended', 'hangup');
  }, [finishCall]);

  const reset = useCallback(() => {
    releaseResources();
    setSubtitles([]);
    setTaskId(null);
    setEndReason(null);
    setError(null);
    syncState('idle');
  }, [releaseResources, syncState]);

  // 麦克风失败（useAudioRecorder 内部吞错误置 error 态）→ 终止通话
  const recorderError = recorder.state === 'error' ? recorder.error : null;
  useEffect(() => {
    if (recorderError && (stateRef.current === 'dialing' || stateRef.current === 'in-call')) {
      finishCall('error', 'error', recorderError);
    }
  }, [recorderError, finishCall]);

  // 卸载清理全部资源
  useEffect(() => {
    return () => {
      releaseResources();
    };
  }, [releaseResources]);

  return {
    state,
    subtitles,
    taskId,
    endReason,
    error,
    startCall,
    hangup,
    reset,
  };
}
