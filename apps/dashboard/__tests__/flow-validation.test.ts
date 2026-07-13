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

  it('accepts edge intent branches without requiring a default edge', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'd', type: 'dialog', position: { x: 0, y: 100 }, data: { mode: 'script', text: '请选择', interruptible: true, waitForResponse: true } },
        { id: 'e1', type: 'end', position: { x: -100, y: 200 }, data: { mode: 'complete' } },
        { id: 'e2', type: 'end', position: { x: 100, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [
        { id: '1', source: 's', target: 'd' },
        { id: '2', source: 'd', target: 'e1', label: '同意', intentExamples: ['可以'] },
        { id: '3', source: 'd', target: 'e2', label: '拒绝', intentExamples: ['不用了'] },
      ],
    });

    expect(issues).toEqual([]);
  });

  it('rejects disconnected and unreachable nodes', () => {
    const issues = validateFlowDefinition({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'd', type: 'dialog', position: { x: 0, y: 100 }, data: { mode: 'script', text: 'hi', interruptible: true, waitForResponse: false } },
        { id: 'e', type: 'end', position: { x: 0, y: 200 }, data: { mode: 'complete' } },
      ],
      edges: [{ id: '1', source: 's', target: 'e' }],
    });

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'dead_end',
      'unreachable_node',
    ]));
  });

});
