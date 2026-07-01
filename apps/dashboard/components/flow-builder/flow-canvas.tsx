'use client';

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeTypes,
  type NodeChange,
  type EdgeChange,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useFlowStore } from './store/flow-store';
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

  const rfNodes = useMemo(() => nodes as unknown as Node[], [nodes]);
  const rfEdges = useMemo(() => edges as unknown as Edge[], [edges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, rfNodes) as unknown as typeof nodes;
      useFlowStore.setState({ nodes: next });
    },
    [rfNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, rfEdges) as unknown as typeof edges;
      useFlowStore.setState({ edges: next });
    },
    [rfEdges],
  );

  return (
    <div className="flow-editor-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => setSelectedNode(node.id)}
        onPaneClick={() => setSelectedNode(undefined)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          style: { stroke: '#94a3b8', strokeWidth: 1.5 },
          type: 'smoothstep',
        }}
        connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 2 }}
      >
        <Background
          color="#cbd5e1"
          gap={20}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const meta = (n.type ?? 'dialog') as string;
            switch (meta) {
              case 'start':    return '#2563eb';
              case 'dialog':   return '#10b981';
              case 'decision': return '#f59e0b';
              case 'action':   return '#8b5cf6';
              case 'end':      return '#ef4444';
              default:         return '#94a3b8';
            }
          }}
          maskColor="rgba(248, 250, 252, 0.7)"
        />
      </ReactFlow>

      {/* 空画布引导 */}
      {nodes.length === 0 && (
        <div className="flow-canvas-empty">
          <svg className="flow-canvas-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="6" height="6" rx="1" />
            <rect x="15" y="15" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
            <path d="M6 9v3a3 3 0 0 0 3 3" />
            <path d="M15 12h-3a3 3 0 0 0-3 3" />
          </svg>
          <div className="flow-canvas-empty-title">开始搭建你的外呼流程</div>
          <div className="flow-canvas-empty-desc">
            从左侧 Start 节点开始，依次添加对话、判断、动作节点，最终连接到 End 节点
          </div>
        </div>
      )}
    </div>
  );
}