/**
 * DialogForm — 节点配置精简（外呼流程优化项 #3）
 *
 * AI 对话节点配置面板只保留「回复目标」（prompt）一个配置项，
 * 「系统提示词」（systemPrompt）UI 输入已移除；但数据字段仍原样透传，
 * 存量流程已配置的 systemPrompt 值不会被清空或覆盖。
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '@ai-call/shared';
import { DialogForm } from '../components/flow-builder/forms/dialog-form';

vi.mock('@/hooks/use-global-config', () => ({
  useGlobalConfig: () => ({ data: { globalVariables: [] } }),
}));

function buildAiNode(overrides: Record<string, unknown> = {}): FlowNode {
  return {
    id: 'node-1',
    type: 'dialog',
    position: { x: 0, y: 0 },
    data: {
      mode: 'ai',
      prompt: '确认客户是否收到商品',
      // 存量流程遗留字段：UI 不再提供输入框，但数据必须原样保留
      systemPrompt: '你是资深客服，语气温和专业',
      interruptible: true,
      waitForResponse: false,
      ...overrides,
    },
  } as unknown as FlowNode;
}

describe('DialogForm — AI 节点只保留「回复目标」配置项', () => {
  it('不渲染系统提示词输入框，只保留回复目标', () => {
    render(<DialogForm node={buildAiNode()} onUpdate={vi.fn()} />);

    expect(screen.getByText('回复目标')).toBeTruthy();
    expect(screen.queryByText('系统提示词')).toBeNull();
    // ai 模式下唯一的可编辑文本区应是「回复目标」
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('编辑回复目标只 emit prompt 字段，不会触碰 systemPrompt', () => {
    const onUpdate = vi.fn();
    render(<DialogForm node={buildAiNode()} onUpdate={onUpdate} />);

    const editor = screen.getAllByRole('textbox')[0];
    editor.textContent = '确认客户是否已收到新订单';
    fireEvent.input(editor);

    expect(onUpdate).toHaveBeenCalledWith({ prompt: '确认客户是否已收到新订单' });
    expect(onUpdate.mock.calls.some(([patch]) => 'systemPrompt' in (patch as object))).toBe(false);
  });
});
