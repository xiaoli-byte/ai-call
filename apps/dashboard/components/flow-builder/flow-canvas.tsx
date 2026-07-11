'use client';

import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeTypes,
  type NodeChange,
  type EdgeChange,
  type Edge,
  type Node,
  type Connection,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useFlowStore } from './store/flow-store';
import styles from './flow-builder.module.scss';
import { StartNode } from './nodes/start-node';
import { DialogNode } from './nodes/dialog-node';
import { DecisionNode } from './nodes/decision-node';
import { ActionNode } from './nodes/action-node';
import { EndNode } from './nodes/end-node';

const nodeTypes: NodeTypes = {
  start: StartNode,
  dialog: DialogNode,
  decision: DecisionNode,
  action: ActionNode,
  end: EndNode,
};

export function FlowCanvas() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const setSelectedNode = useFlowStore((s) => s.setSelectedNode);
  const setSelectedEdge = useFlowStore((s) => s.setSelectedEdge);
  const connectEdge = useFlowStore((s) => s.connectEdge);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);

  const rfNodes = useMemo(() => nodes as unknown as Node[], [nodes]);
  const rfEdges = useMemo(
    () => edges.map((edge) => ({
      ...edge,
      label: edge.label?.trim() || '默认',
    })) as unknown as Edge[],
    [edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, rfNodes) as unknown as typeof nodes;
      useFlowStore.setState({ nodes: next });
    },
    [rfNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(
        changes,
        edges as unknown as Edge[],
      ) as unknown as typeof edges;
      useFlowStore.setState({ edges: next });
    },
    [edges],
  );

  // 拖拽连线：从节点 source handle 拖到 target handle
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      connectEdge(connection.source, connection.target);
    },
    [connectEdge],
  );

  // Ctrl+Z / Ctrl+Y 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  return (
    <div className={styles.flowEditorCanvas}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => setSelectedNode(node.id)}
        onEdgeClick={(_, edge) => setSelectedEdge(edge.id)}
        onPaneClick={() => {
          setSelectedNode(undefined);
          setSelectedEdge(undefined);
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          style: { stroke: '#94a3b8', strokeWidth: 1.5 },
          labelStyle: { fill: '#64748b', fontSize: 12 },
          labelBgStyle: { fill: '#ffffff' },
          labelBgPadding: [4, 2] as never,
          labelBgBorderRadius: 4,
          markerEnd: { type: 'arrowclosed' as never, color: '#94a3b8' },
        }}
      >
        <Background color="#e2e8f0" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={() => '#3b82f6'}
          maskColor="rgba(15, 23, 42, 0.04)"
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className={styles.flowCanvasEmpty}>
          <svg className={styles.flowCanvasEmptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <div className={styles.flowCanvasEmptyTitle}>从 Start 节点开始搭建流程</div>
          <div className={styles.flowCanvasEmptyDesc}>
            点击节点间的 + 号添加新节点，或从节点底部拖拽连线
          </div>
        </div>
      )}
    </div>
  );
}
