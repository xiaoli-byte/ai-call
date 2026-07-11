import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '@ai-call/shared';
import { normalizeFlowForEditor } from '../components/flow-builder/flow-migrations';

describe('normalizeFlowForEditor', () => {
  it('folds a legacy decision into intent-enabled edges', () => {
    const nodes: FlowNode[] = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      {
        id: 'dialog',
        type: 'dialog',
        position: { x: 0, y: 100 },
        data: { mode: 'question', prompt: '是否需要帮助？', interruptible: true, waitForResponse: true },
      },
      {
        id: 'decision',
        type: 'decision',
        position: { x: 0, y: 200 },
        data: {
          mode: 'intent',
          intents: ['需要人工'],
          intentExamples: { 需要人工: ['帮我转人工', '我要找客服'] },
        },
      },
      { id: 'action', type: 'action', position: { x: -100, y: 300 }, data: { actionType: 'transfer', config: {} } },
      { id: 'end', type: 'end', position: { x: 100, y: 300 }, data: { mode: 'complete' } },
    ];
    const edges: FlowEdge[] = [
      { id: 'e1', source: 'start', target: 'dialog' },
      { id: 'e2', source: 'dialog', target: 'decision' },
      { id: 'e3', source: 'decision', target: 'action', label: '需要人工' },
      { id: 'e4', source: 'decision', target: 'end', label: '其他' },
    ];

    const normalized = normalizeFlowForEditor(nodes, edges);

    expect(normalized.nodes.some((node) => node.type === 'decision')).toBe(false);
    expect(normalized.nodes.find((node) => node.id === 'dialog')?.data).toMatchObject({
      mode: 'script',
      text: '是否需要帮助？',
      waitForResponse: true,
    });
    expect(normalized.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'dialog',
        target: 'action',
        label: '需要人工',
        intentExamples: ['帮我转人工', '我要找客服'],
      }),
      expect.objectContaining({ source: 'dialog', target: 'end' }),
    ]));
    expect(normalized.edges.find((edge) => edge.target === 'end')?.label).toBeUndefined();
  });
});
