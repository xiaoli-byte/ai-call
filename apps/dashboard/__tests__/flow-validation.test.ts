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
      'default_branch',
      'unreachable_node',
    ]));
  });
});
