'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_META } from '../types/flow';
import { AddButton } from '../add-button';
import type { FlowNodeType } from '@ai-call/shared';

interface NodeShellProps {
  type: FlowNodeType;
  id: string;
  selected?: boolean;
  summary?: string;
  isConfigured?: boolean;
  modeLabel?: string;
}

/**
 * 节点统一外壳 — 浅色 SaaS 风格（Linear/Notion 风格）
 *
 * 视觉结构：
 *  - 顶部 3px 彩色 accent
 *  - Header: 类型图标 + 标题 + (mode badge)
 *  - Body:   配置摘要（2 行截断）
 *  - Footer: 配置状态指示
 */
export function NodeShell({
  type,
  id,
  selected,
  summary,
  isConfigured,
  modeLabel,
}: NodeShellProps) {
  const meta = NODE_META[type];
  const Icon = meta.icon;
  const configured = isConfigured ?? false;
  const showAddButton = type !== 'end';

  return (
    <div className="relative">
      <div
        className={`flow-node flow-node-accent-${meta.accent} ${
          selected ? 'selected' : ''
        }`}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-white !border-primary-600"
        />

        {/* Header */}
        <div className="flow-node-header">
          <div className={`flow-node-icon flow-node-icon-${meta.accent}`}>
            <Icon className="" />
          </div>
          <span className="flow-node-title">{meta.title}</span>
          {modeLabel && <span className="flow-node-mode">{modeLabel}</span>}
        </div>

        {/* Body */}
        <div className={`flow-node-body ${!summary ? 'empty' : ''}`}>
          {summary || '尚未配置，点击右侧属性面板进行设置'}
        </div>

        {/* Footer */}
        <div className="flow-node-footer">
          <span className={`flow-node-status ${configured ? 'configured' : 'unconfigured'}`}>
            {configured ? '已配置' : '未配置'}
          </span>
          <span className="flow-node-meta">#{id.slice(0, 6)}</span>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-white !border-primary-600"
        />
      </div>

      {/* + 号按钮：非 end 节点底部，用于插入下游节点 */}
      {showAddButton && (
        <div className="flow-add-row">
          <AddButton afterNodeId={id} />
        </div>
      )}
    </div>
  );
}