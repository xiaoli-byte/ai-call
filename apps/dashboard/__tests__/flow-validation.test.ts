import { describe, expect, it } from 'vitest';
import { validateFlowDefinition } from '@ai-call/shared';

describe('validateFlowDefinition', () => {
  it('accepts a reachable start-dialog-end flow', () => {
    expect(validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'd', type: 'dialog', position: { x: 0, y: 100 }, data: { mode: 'script', text: 'hi', interruptible: true, waitForResponse: false } },
        { id: 'e', type: 'end', position: { x: 0, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'd' },
        { id: '2', source: 'd', target: 'e' },
      ],
    })).toEqual([]);
  });

  it('accepts intent branches directly on a dialog node', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'd', type: 'dialog', position: { x: 0, y: 100 }, data: { mode: 'script', text: '需要帮助吗？', interruptible: true, waitForResponse: true } },
        { id: 'a', type: 'action', position: { x: -100, y: 200 }, data: { actionType: 'transfer', config: {} } },
        { id: 'e', type: 'end', position: { x: 100, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'd' },
        { id: '2', source: 'd', target: 'a', label: '需要人工', intentExamples: ['帮我转人工'] },
        { id: '3', source: 'd', target: 'e' },
        { id: '4', source: 'a', target: 'e' },
      ],
    });

    expect(issues).toEqual([]);
  });

  it('requires one default edge when a regular node has multiple branches', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'd', type: 'dialog', position: { x: 0, y: 100 }, data: { mode: 'script', text: '请选择', interruptible: true, waitForResponse: true } },
        { id: 'e1', type: 'end', position: { x: -100, y: 200 }, data: { mode: 'complete' } },
        { id: 'e2', type: 'end', position: { x: 100, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'd' },
        { id: '2', source: 'd', target: 'e1', label: '同意' },
        { id: '3', source: 'd', target: 'e2', label: '拒绝' },
      ],
    });

    expect(issues.map((issue) => issue.code)).toContain('missing_intent_fallback');
  });

  it('rejects unreachable and incomplete decision graphs', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'decision', type: 'decision', position: { x: 0, y: 100 }, data: { mode: 'intent' } },
        { id: 'e', type: 'end', position: { x: 0, y: 200 }, data: { mode: 'complete' } },
        { id: 'orphan', type: 'end', position: { x: 200, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'decision' },
        { id: '2', source: 'decision', target: 'e', label: 'yes' },
      ],
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'decision_branches',
      'missing_intent_fallback',
      'unreachable_node',
    ]));
  });

  it('rejects an intent-mode decision node without a fallback edge', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'decision', type: 'decision', position: { x: 0, y: 100 }, data: { mode: 'intent', intents: ['感兴趣', '拒绝'] } },
        { id: 'e1', type: 'end', position: { x: 0, y: 200 }, data: { mode: 'complete' } },
        { id: 'e2', type: 'end', position: { x: 200, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'decision' },
        { id: '2', source: 'decision', target: 'e1', label: '感兴趣' },
        { id: '3', source: 'decision', target: 'e2', label: '拒绝' },
      ],
    });
    expect(issues.map((issue) => issue.code)).toContain('missing_intent_fallback');
  });

  it('accepts an intent-mode decision node with an unlabeled fallback edge', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'decision', type: 'decision', position: { x: 0, y: 100 }, data: { mode: 'intent', intents: ['感兴趣', '拒绝'] } },
        { id: 'e1', type: 'end', position: { x: 0, y: 200 }, data: { mode: 'complete' } },
        { id: 'e2', type: 'end', position: { x: 200, y: 200 }, data: { mode: 'complete' } },
        { id: 'e3', type: 'end', position: { x: 400, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'decision' },
        { id: '2', source: 'decision', target: 'e1', label: '感兴趣' },
        { id: '3', source: 'decision', target: 'e2', label: '拒绝' },
        { id: '4', source: 'decision', target: 'e3' },
      ],
    });
    expect(issues.map((issue) => issue.code)).not.toContain('missing_intent_fallback');
  });

  it('accepts an intent-mode decision node with a "其他" fallback edge', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'decision', type: 'decision', position: { x: 0, y: 100 }, data: { mode: 'intent', intents: ['感兴趣', '拒绝'] } },
        { id: 'e1', type: 'end', position: { x: 0, y: 200 }, data: { mode: 'complete' } },
        { id: 'e2', type: 'end', position: { x: 200, y: 200 }, data: { mode: 'complete' } },
        { id: 'e3', type: 'end', position: { x: 400, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'decision' },
        { id: '2', source: 'decision', target: 'e1', label: '感兴趣' },
        { id: '3', source: 'decision', target: 'e2', label: '拒绝' },
        { id: '4', source: 'decision', target: 'e3', label: '其他' },
      ],
    });
    expect(issues).toEqual([]);
  });

  it('does not require a fallback edge for a condition-mode decision node', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'decision', type: 'decision', position: { x: 0, y: 100 }, data: { mode: 'condition', expression: "response.includes('满意')" } },
        { id: 'e1', type: 'end', position: { x: 0, y: 200 }, data: { mode: 'complete' } },
        { id: 'e2', type: 'end', position: { x: 200, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'decision' },
        { id: '2', source: 'decision', target: 'e1', label: 'true' },
        { id: '3', source: 'decision', target: 'e2', label: 'false' },
      ],
    });
    expect(issues.map((issue) => issue.code)).not.toContain('missing_intent_fallback');
  });
});
