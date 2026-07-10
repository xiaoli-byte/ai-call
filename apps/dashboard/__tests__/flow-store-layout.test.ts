import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '@ai-call/shared';
import { useFlowStore } from '../components/flow-builder/store/flow-store';

const nodes: FlowNode[] = [
  { id: 'start', type: 'start', position: { x: 800, y: 400 }, data: {} },
  {
    id: 'dialog',
    type: 'dialog',
    position: { x: 600, y: 400 },
    data: { mode: 'script', text: 'hello', interruptible: true, waitForResponse: true },
  },
  {
    id: 'decision',
    type: 'decision',
    position: { x: 400, y: 400 },
    data: { mode: 'intent', intents: ['yes', 'no'] },
  },
  {
    id: 'action',
    type: 'action',
    position: { x: 200, y: 300 },
    data: { actionType: 'crm', config: { action: 'follow_up' } },
  },
  {
    id: 'handoff',
    type: 'action',
    position: { x: 200, y: 500 },
    data: { actionType: 'transfer', config: { extension: '9000' } },
  },
  {
    id: 'end',
    type: 'end',
    position: { x: 0, y: 400 },
    data: { mode: 'complete', farewell: 'bye' },
  },
];

const edges: FlowEdge[] = [
  { id: 'e1', source: 'start', target: 'dialog' },
  { id: 'e2', source: 'dialog', target: 'decision' },
  { id: 'e3', source: 'decision', target: 'action' },
  { id: 'e4', source: 'decision', target: 'handoff' },
  { id: 'e5', source: 'action', target: 'end' },
  { id: 'e6', source: 'handoff', target: 'end' },
];

describe('flow store layout', () => {
  it('organizes a branched flow from top to bottom', () => {
    const store = useFlowStore.getState();
    store.setFlow(nodes, edges);
    useFlowStore.getState().organizeLayout();

    const arranged = useFlowStore.getState().nodes;
    const byId = new Map(arranged.map((node) => [node.id, node]));

    expect(byId.get('start')?.position.y).toBeLessThan(byId.get('dialog')!.position.y);
    expect(byId.get('dialog')?.position.y).toBeLessThan(byId.get('decision')!.position.y);
    expect(byId.get('action')?.position.y).toBe(byId.get('handoff')?.position.y);
    expect(byId.get('action')?.position.x).toBeLessThan(byId.get('handoff')!.position.x);
    expect(byId.get('end')?.position.y).toBeGreaterThan(byId.get('action')!.position.y);
  });
});
