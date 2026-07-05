/**
 * useASR Hook 单元测试
 *
 * 通过 mock ASRStreamClient 和 useAudioRecorder 验证 Hook 的状态管理逻辑：
 *   - 初始状态
 *   - start/stop 状态转换
 *   - partial/final 结果处理
 *   - vad_state 驱动 isSpeaking
 *   - 错误处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ─── Mock ASRStreamClient ───
vi.mock('@/lib/voice-agent-client', () => {
  return {
    ASRStreamClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      sendAudio: vi.fn(),
      endSpeech: vi.fn(),
      get ready() { return true; },
      get connectionState() { return 'connected'; },
    })),
  };
});

// ─── Mock useAudioRecorder ───
const mockRecorder = {
  state: 'idle' as string,
  isRecording: false,
  audioLevel: 0,
  isSpeaking: false,
  error: null as string | null,
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  onAudioFrame: vi.fn(),
  onSpeechStart: vi.fn(),
  onSpeechEnd: vi.fn(),
  updateVADConfig: vi.fn(),
};

vi.mock('@/hooks/useAudioRecorder', () => ({
  useAudioRecorder: vi.fn(() => mockRecorder),
}));

import { useASR } from '@/hooks/useASR';
import { ASRStreamClient } from '@/lib/voice-agent-client';

describe('useASR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecorder.state = 'idle';
    mockRecorder.isRecording = false;
    mockRecorder.error = null;
  });

  it('初始状态应为 idle', () => {
    const { result } = renderHook(() => useASR());
    expect(result.current.state).toBe('idle');
    expect(result.current.isListening).toBe(false);
    expect(result.current.partialText).toBe('');
    expect(result.current.finalTexts).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isSpeaking).toBe(false);
  });

  it('start() 应创建 ASRStreamClient 并连接', async () => {
    const { result } = renderHook(() => useASR());

    await act(async () => {
      await result.current.start();
    });

    expect(ASRStreamClient).toHaveBeenCalled();
    const instance = (ASRStreamClient as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(instance.connect).toHaveBeenCalled();
    expect(mockRecorder.onAudioFrame).toHaveBeenCalled();
    expect(mockRecorder.start).toHaveBeenCalled();
  });

  it('音频回调应批量发送 200ms PCM，降低 WebSocket 消息频率', async () => {
    const { result } = renderHook(() => useASR());

    await act(async () => {
      await result.current.start();
    });

    const instance = (ASRStreamClient as ReturnType<typeof vi.fn>).mock.results[0].value;
    const audioCallback = mockRecorder.onAudioFrame.mock.calls[0][0] as (pcmData: ArrayBuffer) => void;

    for (let i = 0; i < 9; i++) {
      audioCallback(new ArrayBuffer(640));
    }
    expect(instance.sendAudio).not.toHaveBeenCalled();

    audioCallback(new ArrayBuffer(640));
    expect(instance.sendAudio).toHaveBeenCalledTimes(1);
    expect(instance.sendAudio.mock.calls[0][0].byteLength).toBe(6400);
  });

  it('endSentence() 应先发送剩余音频再断句', async () => {
    const { result } = renderHook(() => useASR());

    await act(async () => {
      await result.current.start();
    });

    const instance = (ASRStreamClient as ReturnType<typeof vi.fn>).mock.results[0].value;
    const audioCallback = mockRecorder.onAudioFrame.mock.calls[0][0] as (pcmData: ArrayBuffer) => void;

    audioCallback(new ArrayBuffer(640));
    expect(instance.sendAudio).not.toHaveBeenCalled();

    act(() => {
      result.current.endSentence();
    });

    expect(instance.sendAudio).toHaveBeenCalledTimes(1);
    expect(instance.sendAudio.mock.calls[0][0].byteLength).toBe(640);
    expect(instance.endSpeech).toHaveBeenCalled();
  });

  it('stop() 应断开连接并停止录音', async () => {
    const { result } = renderHook(() => useASR());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    const instance = (ASRStreamClient as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(instance.disconnect).toHaveBeenCalled();
    expect(mockRecorder.stop).toHaveBeenCalled();
  });

  it('clear() 应清空识别结果', async () => {
    const { result } = renderHook(() => useASR());

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.partialText).toBe('');
    expect(result.current.finalTexts).toEqual([]);
  });

  it('endSentence() 应调用 client.endSpeech()', async () => {
    const { result } = renderHook(() => useASR());

    await act(async () => {
      await result.current.start();
    });

    const instance = (ASRStreamClient as ReturnType<typeof vi.fn>).mock.results[0].value;

    act(() => {
      result.current.endSentence();
    });

    expect(instance.endSpeech).toHaveBeenCalled();
  });

  it('start() 连接失败时应设置 error 状态', async () => {
    const { ASRStreamClient: MockedClient } = await import('@/lib/voice-agent-client');
    (MockedClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      connect: vi.fn().mockRejectedValue(new Error('连接被拒绝')),
      disconnect: vi.fn(),
      sendAudio: vi.fn(),
      endSpeech: vi.fn(),
    }));

    const { result } = renderHook(() => useASR());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toContain('连接被拒绝');
    expect(result.current.state).toBe('error');
  });
});
