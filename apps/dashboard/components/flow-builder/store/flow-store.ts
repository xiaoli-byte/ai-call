/**
 * Zustand Flow Store
 *
 * 管理 nodes/edges/selectedNodeId/history，含节点增删改、边 label 更新、撤销重做。
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
  history: FlowSnapshot[];
  historyIndex: number;

  setSelectedNode: (id?: string) => void;

  addNode: (afterNodeId: string, type: FlowNodeType) => void;
  updateNode: (id: string, data: Partial<FlowNode['data']>) => void;
  deleteNode: (id: string) => void;

  updateEdgeLabel: (edgeId: string, label: string) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setFlow: (nodes: FlowNode[], edges: FlowEdge[]) => void;
}

const NODE_SPACING = 140;

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
  // 限制 50 步
  while (newHistory.length > 50) newHistory.shift();
  return { history: newHistory, historyIndex: newHistory.length - 1 };
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],
  history: [{ nodes: [], edges: [] }],
  historyIndex: 0,

  setSelectedNode: (id) => set({ selectedNodeId: id }),

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

    // 找到 afterNode 的下游边（取第一条）
    const downstreamEdge = state.edges.find((e) => e.source === afterNodeId);
    const newEdges: FlowEdge[] = [
      { id: genId(), source: afterNodeId, target: newNode.id },
    ];

    if (downstreamEdge) {
      // 断开原边，新节点连接到下游
      newEdges.push({
        id: genId(),
        source: newNode.id,
        target: downstreamEdge.target,
        label: downstreamEdge.label,
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
    // 不允许删除 start 节点
    const node = state.nodes.find((n) => n.id === id);
    if (!node || node.type === 'start') return;

    const nodes = state.nodes.filter((n) => n.id !== id);
    const removedEdges = state.edges.filter(
      (e) => e.source === id || e.target === id,
    );
    const edges = state.edges.filter(
      (e) => e.source !== id && e.target !== id,
    );

    // 重连：被删节点的上游 → 下游
    for (const removed of removedEdges) {
      if (removed.target === id) {
        // 找到被删节点的下游
        const downstream = removedEdges.find((e) => e.source === id);
        if (downstream) {
          edges.push({
            id: genId(),
            source: removed.source,
            target: downstream.target,
            label: downstream.label,
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

  updateEdgeLabel: (edgeId, label) => {
    const state = get();
    const edges = state.edges.map((e) =>
      e.id === edgeId ? { ...e, label } : e,
    );
    set({
      edges,
      ...pushHistory(state, { nodes: state.nodes, edges }),
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
    });
  },
}));
