/**
 * 首页浏览器模拟外呼测试（契约 §3/§4，2026-07-17 起全程匿名）
 *
 * ① 发起时序：POST /web-demo/calls { flowId } → 用返回 attemptId 拼首帧 metadata；
 * ② 文本帧 agent_speech/caller_speech 渲染进字幕列表，end 帧置 ended 态；
 * ③ 挂断：关 WS、停止采集；
 * ④ 流程列表加载失败 → 面板内报错并可重试，绝不跳登录页。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, fireEvent, waitFor, screen } from '@testing-library/react';

// ─── Mock apiClient（useWebCall 与 WebCallPanel 共用，匿名公开端点） ───
const apiMocks = vi.hoisted(() => ({
  startDemoCall: vi.fn(),
  listFlows: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    webDemo: {
      flows: apiMocks.listFlows,
      startCall: apiMocks.startDemoCall,
    },
  },
}));

// ─── Mock useAudioRecorder（麦克风采集链） ───
const mockRecorder = vi.hoisted(() => ({
  state: 'idle' as string,
  isRecording: false,
  audioLevel: 0,
  isSpeaking: false,
  error: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
  onAudioFrame: vi.fn(),
  onSpeechStart: vi.fn(),
  onSpeechEnd: vi.fn(),
  updateVADConfig: vi.fn(),
}));

vi.mock('@/hooks/useAudioRecorder', () => ({
  useAudioRecorder: vi.fn(() => mockRecorder),
}));

// ─── Mock WebSocket（连接后自动 open） ───
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  binaryType = 'blob';
  readyState = 0; // CONNECTING
  sent: (string | ArrayBuffer)[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.closed) return;
      this.readyState = 1; // OPEN
      this.onopen?.();
    });
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.onclose?.({ code: 1000, reason: '' });
  }
}

// ─── Mock AudioContext（播放链，ensureAudioContext 使用全局构造器） ───
class MockAudioContext {
  static instances: MockAudioContext[] = [];
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  sources: { buffer: unknown; onended: (() => void) | null; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];

  constructor() {
    MockAudioContext.instances.push(this);
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  createBufferSource() {
    const source = {
      buffer: null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
}

import { useWebCall } from '@/hooks/useWebCall';
import WebCallPanel from '@/components/home/WebCallPanel';

const START_PARAMS = { flowId: 'flow-1' };

/** 发起并等待 WS open（MockWebSocket 微任务内自动 open） */
async function startCall(result: { current: ReturnType<typeof useWebCall> }) {
  await act(async () => {
    await result.current.startCall(START_PARAMS);
  });
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

describe('useWebCall / WebCallPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    MockAudioContext.instances = [];
    mockRecorder.state = 'idle';
    mockRecorder.error = null;
    mockRecorder.start.mockResolvedValue(undefined);
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('AudioContext', MockAudioContext);

    apiMocks.startDemoCall.mockResolvedValue({
      taskId: 'task-1',
      attemptId: 'attempt-9',
      status: 'CALLING',
    });
    apiMocks.listFlows.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('① 发起时序：POST /web-demo/calls → 首帧 metadata 用返回的 attemptId', async () => {
    const { result } = renderHook(() => useWebCall());

    const ws = await startCall(result);

    // 只带 flowId，被叫与通道由服务端强制
    expect(apiMocks.startDemoCall).toHaveBeenCalledWith('flow-1');

    // WS 指向 /audio-stream，binaryType=arraybuffer
    expect(ws.url.endsWith('/audio-stream')).toBe(true);
    expect(ws.binaryType).toBe('arraybuffer');

    // 首帧 metadata（契约 §3；未配置 token 则不带该字段）
    expect(typeof ws.sent[0]).toBe('string');
    const metadata = JSON.parse(ws.sent[0] as string);
    expect(metadata).toEqual({
      dialog_id: 'attempt-9',
      channel: 'web',
      audio_response_format: 'raw-pcm',
    });

    expect(result.current.state).toBe('in-call');
    expect(result.current.taskId).toBe('task-1');

    // 上行聚批：20ms 帧（640B）累计 60ms（1920B）发送，降低打断延迟
    const audioCallback = mockRecorder.onAudioFrame.mock.calls[0][0] as (
      pcm: ArrayBuffer,
    ) => void;
    for (let i = 0; i < 2; i++) audioCallback(new ArrayBuffer(640));
    expect(ws.sent.length).toBe(1); // 仍只有 metadata
    audioCallback(new ArrayBuffer(640));
    expect(ws.sent.length).toBe(2);
    expect((ws.sent[1] as ArrayBuffer).byteLength).toBe(1920);
  });

  it('② 文本帧渲染进字幕列表，end 帧置 ended 态', async () => {
    const { result } = renderHook(() => useWebCall());
    const ws = await startCall(result);

    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'agent_speech', text: '您好，这里是售后回访。' }) });
      ws.onmessage?.({ data: JSON.stringify({ type: 'caller_speech', text: '我没收到包裹。' }) });
    });

    expect(result.current.subtitles).toEqual([
      { id: 1, role: 'agent', text: '您好，这里是售后回访。' },
      { id: 2, role: 'caller', text: '我没收到包裹。' },
    ]);
    expect(result.current.state).toBe('in-call');

    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'end', reason: 'completed' }) });
    });

    expect(result.current.state).toBe('ended');
    expect(result.current.endReason).toBe('completed');
    // 结束时资源已释放
    expect(mockRecorder.stop).toHaveBeenCalled();
  });

  it('③ 挂断：关 WS、停止采集、置 ended', async () => {
    const { result } = renderHook(() => useWebCall());
    const ws = await startCall(result);

    act(() => {
      result.current.hangup();
    });

    expect(ws.closed).toBe(true);
    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(result.current.state).toBe('ended');
    expect(result.current.endReason).toBe('hangup');

    // 挂断后不再上行音频
    const audioCallback = mockRecorder.onAudioFrame.mock.calls[0][0] as (
      pcm: ArrayBuffer,
    ) => void;
    const sentBefore = ws.sent.length;
    for (let i = 0; i < 10; i++) audioCallback(new ArrayBuffer(640));
    expect(ws.sent.length).toBe(sentBefore);
  });

  it('end 帧先于播放队列排空到达时，等尾段音频播完再置 ended（不掐断话术）', async () => {
    const { result } = renderHook(() => useWebCall());
    const ws = await startCall(result);

    // 1 秒下行音频入队（32000B s16le / 16kHz = 1s），nextPlayTime 推进到 1s
    act(() => {
      ws.onmessage?.({ data: new ArrayBuffer(32000) });
    });

    vi.useFakeTimers();
    try {
      act(() => {
        ws.onmessage?.({ data: JSON.stringify({ type: 'end', reason: 'completed' }) });
      });

      // 立即停采集、关 WS，但状态保持 in-call 直到播放排空
      expect(mockRecorder.stop).toHaveBeenCalled();
      expect(ws.closed).toBe(true);
      expect(result.current.state).toBe('in-call');

      act(() => {
        vi.advanceTimersByTime(1200); // 1000ms 剩余 + 150ms 余量
      });
      expect(result.current.state).toBe('ended');
      expect(result.current.endReason).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clear_audio 帧：已排队音源全部 stop，状态仍 in-call，后续音频仍可继续排队播放', async () => {
    const { result } = renderHook(() => useWebCall());
    const ws = await startCall(result);

    act(() => {
      ws.onmessage?.({ data: new ArrayBuffer(3200) });
      ws.onmessage?.({ data: new ArrayBuffer(3200) });
    });
    const sourcesBeforeClear = MockAudioContext.instances[MockAudioContext.instances.length - 1].sources;
    expect(sourcesBeforeClear.length).toBe(2);
    expect(sourcesBeforeClear.some((s) => (s.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(false);

    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'clear_audio' }) });
    });

    expect(sourcesBeforeClear.every((s) => (s.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
    expect(result.current.state).toBe('in-call');

    act(() => {
      ws.onmessage?.({ data: new ArrayBuffer(3200) });
    });
    const sourcesAfterClear = MockAudioContext.instances[MockAudioContext.instances.length - 1].sources;
    expect(sourcesAfterClear.length).toBe(3); // 前 2 个仍在数组里（onended 未触发），新增 1 个
  });

  it('④ 流程列表加载失败：面板内报错并可重试，不跳登录页', async () => {
    apiMocks.listFlows.mockRejectedValue(new Error('加载流程列表失败'));

    render(<WebCallPanel />);
    fireEvent.click(screen.getByRole('button', { name: '发起模拟外呼' }));

    expect(await screen.findByText('加载流程列表失败')).toBeTruthy();
    expect(screen.getByText('重新加载流程')).toBeTruthy();
  });

  it('匿名访客：拨号展开面板，可体验流程进下拉且默认选电商 demo，不显示被叫号', async () => {
    apiMocks.listFlows.mockResolvedValue([
      { id: 'flow-a', name: '催收标准流程', scenario: 'collection' },
      { id: 'flow-b', name: '电商回访流程', scenario: 'ecommerce' },
      { id: 'flow-d', name: '编辑中的已发布流程', scenario: null },
    ]);

    render(<WebCallPanel />);
    fireEvent.click(screen.getByRole('button', { name: '发起模拟外呼' }));

    const select = (await screen.findByLabelText('已发布流程')) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe('flow-b'); // 默认电商 demo
    });
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain('催收标准流程');
    // 服务端已过滤/裁剪，前端原样展示，不追加草稿后缀
    expect(options).toContain('编辑中的已发布流程');
    // 被叫号不展示输入框（服务端固定 1001）
    expect(screen.queryByLabelText('被叫号码（仅作任务记录）')).toBeNull();
    // hero 左上角徽标显示当前选中话术名称
    expect(screen.getByText('电商回访流程 · 体验中')).toBeTruthy();
  });
});
