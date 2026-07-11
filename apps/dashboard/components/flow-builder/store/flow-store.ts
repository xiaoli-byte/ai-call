/**
 * Zustand Flow Store
 *
 * 管理 nodes/edges/selectedNodeId/selectedEdgeId/history，
 * 含节点增删改/复制、边连接/删除/label 更新、撤销重做。
 */
import { create } from 'zustand';
import type { FlowEdge, FlowNode, FlowNodeType } from '@ai-call/shared';
import { getDefaultNodeData } from '../types/flow';

interface FlowSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface FlowState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId?: string;
  selectedEdgeId?: string;
  history: FlowSnapshot[];
  historyIndex: number;

  setSelectedNode: (id?: string) => void;
  setSelectedEdge: (id?: string) => void;

  addNode: (afterNodeId: string, type: FlowNodeType) => void;
  updateNode: (id: string, data: Partial<FlowNode['data']>) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;

  connectEdge: (source: string, target: string) => void;
  deleteEdge: (edgeId: string) => void;
  updateEdgeIntent: (
    edgeId: string,
    intent: { label?: string; intentExamples?: string[] },
  ) => void;
  organizeLayout: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setFlow: (nodes: FlowNode[], edges: FlowEdge[]) => void;
}

const NODE_SPACING = 140;
const LAYOUT_X_SPACING = 320;
const LAYOUT_Y_SPACING = 180;
const LAYOUT_START_X = 260;
const LAYOUT_START_Y = 20;

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pushHistory(
  state: FlowState,
  snapshot: FlowSnapshot,
): { history: FlowSnapshot[]; historyIndex: number } {
  const newHistory = state.history.slice(0, state.historyIndex + 1);
  newHistory.push(snapshot);
  while (newHistory.length > 50) newHistory.shift();
  return { history: newHistory, historyIndex: newHistory.length - 1 };
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],
  history: [{ nodes: [], edges: [] }],
  historyIndex: 0,

  setSelectedNode: (id) => set({ selectedNodeId: id, selectedEdgeId: undefined }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: undefined }),

  addNode: (afterNodeId, type) => {
    const state = get();
    const afterNode = state.nodes.find((n) => n.id === afterNodeId);
    if (!afterNode) return;

    const newNode: FlowNode = {
      id: genId(),
      type,
      position: {
        x: afterNode.position.x,
        y: afterNode.position.y + NODE_SPACING,
      },
      data: getDefaultNodeData(type),
    };

    const downstreamEdge = state.edges.find((e) => e.source === afterNodeId);
    const newEdges: FlowEdge[] = [
      {
        id: genId(),
        source: afterNodeId,
        target: newNode.id,
        ...(downstreamEdge?.label !== undefined
          ? { label: downstreamEdge.label }
          : {}),
        ...(downstreamEdge?.intentExamples !== undefined
          ? { intentExamples: downstreamEdge.intentExamples }
          : {}),
      },
    ];

    if (downstreamEdge) {
      newEdges.push({
        id: genId(),
        source: newNode.id,
        target: downstreamEdge.target,
      });
    }

    const nodes = [...state.nodes, newNode];
    const edges = [
      ...state.edges.filter((e) => e.id !== downstreamEdge?.id),
      ...newEdges,
    ];

    set({
      nodes,
      edges,
      selectedNodeId: newNode.id,
      ...pushHistory(state, { nodes, edges }),
    });
  },

  updateNode: (id, data) => {
    const state = get();
    const nodes = state.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
    );
    set({
      nodes,
      ...pushHistory(state, { nodes, edges: state.edges }),
    });
  },

  deleteNode: (id) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === id);
    if (!node || node.type === 'start') return;

    const nodes = state.nodes.filter((n) => n.id !== id);
    const removedEdges = state.edges.filter(
      (e) => e.source === id || e.target === id,
    );
    const edges = state.edges.filter(
      (e) => e.source !== id && e.target !== id,
    );

    for (const removed of removedEdges) {
      if (removed.target === id) {
        const downstream = removedEdges.find((e) => e.source === id);
        if (downstream) {
          edges.push({
            id: genId(),
            source: removed.source,
            target: downstream.target,
            ...(removed.label !== undefined
              ? { label: removed.label }
              : downstream.label !== undefined
                ? { label: downstream.label }
                : {}),
            ...(removed.intentExamples !== undefined
              ? { intentExamples: removed.intentExamples }
              : downstream.intentExamples !== undefined
                ? { intentExamples: downstream.intentExamples }
                : {}),
          });
        }
      }
    }

    set({
      nodes,
      edges,
      selectedNodeId: undefined,
      ...pushHistory(state, { nodes, edges }),
    });
  },

  duplicateNode: (id) => {
    const state = get();
    const src = state.nodes.find((n) => n.id === id);
    if (!src || src.type === 'start') return;

    const newNode: FlowNode = {
      id: genId(),
      type: src.type,
      position: { x: src.position.x + 40, y: src.position.y + 40 },
      data: JSON.parse(JSON.stringify(src.data)),
    };

    const nodes = [...state.nodes, newNode];
    set({
      nodes,
      selectedNodeId: newNode.id,
      ...pushHistory(state, { nodes, edges: state.edges }),
    });
  },

  connectEdge: (source, target) => {
    if (source === target) return;
    const state = get();
    // 避免重复连线
    const exists = state.edges.some(
      (e) => e.source === source && e.target === target,
    );
    if (exists) return;

    const newEdge: FlowEdge = { id: genId(), source, target };
    const edges = [...state.edges, newEdge];
    set({
      edges,
      ...pushHistory(state, { nodes: state.nodes, edges }),
    });
  },

  deleteEdge: (edgeId) => {
    const state = get();
    const edges = state.edges.filter((e) => e.id !== edgeId);
    set({
      edges,
      selectedEdgeId: undefined,
      ...pushHistory(state, { nodes: state.nodes, edges }),
    });
  },

  updateEdgeIntent: (edgeId, intent) => {
    const state = get();
    const edges = state.edges.map((e) =>
      e.id === edgeId ? { ...e, ...intent } : e,
    );
    set({
      edges,
      ...pushHistory(state, { nodes: state.nodes, edges }),
    });
  },

  organizeLayout: () => {
    const state = get();
    if (state.nodes.length === 0) return;

    const nodes = organizeFlowNodes(state.nodes, state.edges);
    set({
      nodes,
      ...pushHistory(state, { nodes, edges: state.edges }),
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;
    const prev = state.history[state.historyIndex - 1];
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      historyIndex: state.historyIndex - 1,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;
    const next = state.history[state.historyIndex + 1];
    set({
      nodes: next.nodes,
      edges: next.edges,
      historyIndex: state.historyIndex + 1,
    });
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  setFlow: (nodes, edges) => {
    set({
      nodes,
      edges,
      history: [{ nodes, edges }],
      historyIndex: 0,
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
    });
  },
}));

function organizeFlowNodes(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const roots = nodes
    .filter((node) => node.type === 'start' || (incomingCount.get(node.id) ?? 0) === 0)
    .sort((a, b) => {
      if (a.type === 'start' && b.type !== 'start') return -1;
      if (a.type !== 'start' && b.type === 'start') return 1;
      return (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0);
    });
  const traversalRoots = roots.length ? roots : nodes.slice(0, 1);

  const depth = new Map<string, number>();
  const visitOrder = new Map<string, number>();
  const queue = traversalRoots.map((node) => {
    depth.set(node.id, 0);
    return { id: node.id, path: new Set([node.id]) };
  });
  let visitIndex = 0;

  for (let i = 0; i < queue.length; i += 1) {
    const { id, path } = queue[i];
    if (!visitOrder.has(id)) {
      visitOrder.set(id, visitIndex);
      visitIndex += 1;
    }
    const nextDepth = (depth.get(id) ?? 0) + 1;
    const targets = outgoing.get(id) ?? [];
    for (const target of targets) {
      if (path.has(target)) continue;
      const currentDepth = depth.get(target);
      if (currentDepth === undefined || nextDepth > currentDepth) {
        depth.set(target, nextDepth);
        queue.push({ id: target, path: new Set([...path, target]) });
      }
    }
  }

  const deepest = Math.max(0, ...Array.from(depth.values()));
  for (const node of nodes) {
    if (!depth.has(node.id)) {
      depth.set(node.id, deepest + 1);
      visitOrder.set(node.id, visitIndex);
      visitIndex += 1;
    }
  }

  const layers = new Map<number, FlowNode[]>();
  for (const node of nodes) {
    const layer = depth.get(node.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  }

  const nextPositionById = new Map<string, { x: number; y: number }>();
  for (const [layer, layerNodes] of layers) {
    const sorted = [...layerNodes].sort((a, b) => (
      (visitOrder.get(a.id) ?? nodeOrder.get(a.id) ?? 0)
      - (visitOrder.get(b.id) ?? nodeOrder.get(b.id) ?? 0)
    ));
    const rowWidth = (sorted.length - 1) * LAYOUT_X_SPACING;
    sorted.forEach((node, index) => {
      nextPositionById.set(node.id, {
        x: LAYOUT_START_X + index * LAYOUT_X_SPACING - rowWidth / 2,
        y: LAYOUT_START_Y + layer * LAYOUT_Y_SPACING,
      });
    });
  }

  return nodes.map((node) => ({
    ...node,
    position: nextPositionById.get(node.id) ?? node.position,
  }));
}
