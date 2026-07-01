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
      { id: genId(), source: afterNodeId, target: newNode.id },
    ];

    if (downstreamEdge) {
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
      selectedEdgeId: undefined,
    });
  },
}));
