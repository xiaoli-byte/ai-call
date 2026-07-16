/**
 * FlowDebugPanel — 测试抽屉优化（外呼流程优化项 #4）
 *
 * ① 每次打开都是一次全新测试：关闭后再打开必须清空上一轮调试对话内容与会话 id；
 * ② 测试变量注入：抽屉支持变量新增/编辑，变量只在本次调试对话的 start 帧中注入，
 *    不落库、不影响流程定义（不改变 onSaveFlow 的调用参数）。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { FlowDebugPanel } from '../components/flow-builder/flow-debug-panel';

// jsdom 未实现 scrollIntoView（ConversationWindow 消息列表滚动到底部时会调用）
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

// ─── Mock WebSocket（连接后自动 open，记录已发送帧） ───
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('FlowDebugPanel', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('① 关闭后再打开 = 全新测试：清空上一轮调试内容与会话态', async () => {
    const onSaveFlow = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <FlowDebugPanel
        flowId="flow-1"
        flowName="测试流程"
        open
        onClose={vi.fn()}
        onSaveFlow={onSaveFlow}
      />,
    );

    fireEvent.click(screen.getByText('开始会话'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];
    await waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'connected', sessionId: 'sess-old' }) });
      ws.onmessage?.({
        data: JSON.stringify({ type: 'agent_speech', text: '您好，这里是测试流程', nodeName: '开场白' }),
      });
    });

    expect(screen.getByText('您好，这里是测试流程')).toBeTruthy();

    // 关闭抽屉
    rerender(
      <FlowDebugPanel
        flowId="flow-1"
        flowName="测试流程"
        open={false}
        onClose={vi.fn()}
        onSaveFlow={onSaveFlow}
      />,
    );

    // 重新打开——应视为一次全新测试
    rerender(
      <FlowDebugPanel
        flowId="flow-1"
        flowName="测试流程"
        open
        onClose={vi.fn()}
        onSaveFlow={onSaveFlow}
      />,
    );

    expect(screen.queryByText('您好，这里是测试流程')).toBeNull();
    // 回到 idle 态，重新展示“开始会话”按钮
    expect(screen.getByText('开始会话')).toBeTruthy();
  });

  it('② 测试变量新增/编辑后随 start 帧注入，不影响 onSaveFlow（不落库）', async () => {
    const onSaveFlow = vi.fn().mockResolvedValue(undefined);
    render(
      <FlowDebugPanel
        flowId="flow-1"
        flowName="测试流程"
        open
        onClose={vi.fn()}
        onSaveFlow={onSaveFlow}
      />,
    );

    // 打开变量区，新增一行变量
    fireEvent.click(screen.getByText(/测试变量/));
    fireEvent.click(screen.getByText('+ 添加变量'));

    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'company' } });
    fireEvent.change(screen.getByLabelText('变量值'), { target: { value: '测试公司' } });

    fireEvent.click(screen.getByText('开始会话'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];
    await waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const startFrame = JSON.parse(ws.sent[0]);
    expect(startFrame).toEqual({
      type: 'start',
      flowId: 'flow-1',
      variables: { company: '测试公司' },
    });
    // 变量仅注入调试对话，不改变保存流程定义的调用
    expect(onSaveFlow).toHaveBeenCalledTimes(1);
    expect(onSaveFlow).toHaveBeenCalledWith();
  });
});
