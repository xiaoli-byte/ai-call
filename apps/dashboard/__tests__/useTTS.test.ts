/**
 * useTTS Hook 单元测试
 *
 * 通过 mock TTSStreamClient 和 audio-utils 验证 Hook 的状态管理逻辑：
 *   - 初始状态
 *   - speak() 状态转换
 *   - stop() 中断逻辑
 *   - 语音参数更新
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ─── Mock TTSStreamClient ───
const mockSynthesize = vi.fn().mockResolvedValue(undefined);
const mockInterrupt = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('@/lib/voice-agent-client', () => {
  return {
    TTSStreamClient: vi.fn().mockImplementation(() => ({
      synthesize: mockSynthesize,
      interrupt: mockInterrupt,
      disconnect: mockDisconnect,
      connect: vi.fn().mockResolvedValue(undefined),
      get isSynthesizing() { return false; },
      get sampleRate() { return 16000; },
    })),
  };
});

// ─── Mock audio-utils ───
vi.mock('@/lib/audio-utils', () => ({
  ensureAudioContext: vi.fn().mockResolvedValue({
    currentTime: 0,
    state: 'running',
    createGain: () => ({
      gain: { value: 1 },
      connect: vi.fn(),
    }),
    createBuffer: () => ({
      copyToChannel: vi.fn(),
      getChannelData: () => ({ set: vi.fn() }),
      duration: 1.0,
    }),
    createBufferSource: () => ({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    }),
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
  pcm16ToFloat32: vi.fn(() => new Float32Array(10)),
}));

import { useTTS } from '@/hooks/useTTS';

describe('useTTS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSynthesize.mockResolvedValue(undefined);
  });

  it('初始状态应为 idle', () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.state).toBe('idle');
    expect(result.current.isBusy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('默认语音参数应正确', () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.voiceParams.volume).toBe(1.0);
    expect(result.current.voiceParams.speaker).toBe('Cherry');
  });

  it('updateVoiceParams 应更新参数', () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.updateVoiceParams({ volume: 0.8, speaker: 'Ethan' });
    });

    expect(result.current.voiceParams.volume).toBe(0.8);
    expect(result.current.voiceParams.speaker).toBe('Ethan');
  });

  it('speak() 应调用 TTSStreamClient.synthesize', async () => {
    const { result } = renderHook(() => useTTS());

    await act(async () => {
      await result.current.speak('你好世界');
    });

    expect(mockSynthesize).toHaveBeenCalledWith(
      '你好世界',
      expect.objectContaining({
        speaker: 'Cherry',
      }),
    );
  });

  it('speak() 空文本不应触发合成', async () => {
    const { result } = renderHook(() => useTTS());

    await act(async () => {
      await result.current.speak('');
    });

    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('speak() 空白文本不应触发合成', async () => {
    const { result } = renderHook(() => useTTS());

    await act(async () => {
      await result.current.speak('   ');
    });

    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('stop() 应调用 interrupt', async () => {
    const { result } = renderHook(() => useTTS());

    // 先 speak 创建 client，再 stop 中断
    await act(async () => {
      await result.current.speak('测试文本');
    });

    act(() => {
      result.current.stop();
    });

    expect(mockInterrupt).toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('speak() 合成失败时应设置 error', async () => {
    mockSynthesize.mockRejectedValueOnce(new Error('服务不可用'));

    const { result } = renderHook(() => useTTS());

    await act(async () => {
      await result.current.speak('测试文本');
    });

    expect(result.current.error).toContain('服务不可用');
  });

  it('instructText 应传入合成选项', async () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.updateVoiceParams({ instructText: '用开心的语气说' });
    });

    await act(async () => {
      await result.current.speak('你好');
    });

    expect(mockSynthesize).toHaveBeenCalledWith(
      '你好',
      expect.objectContaining({
        instructText: '用开心的语气说',
      }),
    );
  });

  it('speak() 单次覆盖应立即使用指定音色和风格', async () => {
    const { result } = renderHook(() => useTTS());

    await act(async () => {
      await result.current.speak('场景试听', {
        speaker: 'Ethan',
        instructText: '沉稳自然',
      });
    });

    expect(mockSynthesize).toHaveBeenCalledWith('场景试听', {
      speaker: 'Ethan',
      instructText: '沉稳自然',
    });
  });
});
