'use client';

import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_META } from '../types/flow';
import { AddButton } from '../add-button';
import { useFlowStore } from '../store/flow-store';
import type { FlowNodeType } from '@ai-call/shared';
import styles from '../flow-builder.module.scss';

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
 *
 * hover 时右上角显示复制/删除按钮（start 不可删/不可复制，删除需二次确认）。
 * 非 end 节点底部渲染 + 号按钮。
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
  const canDelete = type !== 'start';
  const canDuplicate = type !== 'start';
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const duplicateNode = useFlowStore((s) => s.duplicateNode);
  const deleteNode = useFlowStore((s) => s.deleteNode);

  return (
    <div className="relative">
      <div
        className={`${styles.flowNode} flow-node-accent-${meta.accent} ${
          selected ? styles.selected : ''
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
          setConfirming(false);
        }}
      >
        <Handle
          type="target"
          position={Position.Top}
        />

        {/* Hover 操作按钮 */}
        {hovered && (canDelete || canDuplicate) && (
          <div className={styles.flowNodeActions}>
            {canDuplicate && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateNode(id);
                }}
                className={styles.flowNodeActionBtn}
                title="复制节点"
                aria-label="复制节点"
              >
                ⧉
              </button>
            )}
            {canDelete &&
              (confirming ? (
                <div className={styles.flowNodeActionConfirm}>
                  <span>删除?</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNode(id);
                      setConfirming(false);
                    }}
                    className={styles.confirmYes}
                    title="确认删除"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirming(false);
                    }}
                    className={styles.confirmNo}
                    title="取消"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(true);
                  }}
                  className={`${styles.flowNodeActionBtn} ${styles.danger}`}
                  title="删除节点"
                  aria-label="删除节点"
                >
                  ✕
                </button>
              ))}
          </div>
        )}

        {/* Header */}
        <div className={styles.flowNodeHeader}>
          <div className={`${styles.flowNodeIcon} flow-node-icon-${meta.accent}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className={styles.flowNodeTitle}>{meta.title}</div>
          {modeLabel && <div className={styles.flowNodeMode}>{modeLabel}</div>}
        </div>

        {/* Body */}
        <div className={`${styles.flowNodeBody} ${!summary ? styles.empty : ''}`}>
          {summary || '未配置'}
        </div>

        {/* Footer */}
        <div className={styles.flowNodeFooter}>
          <span
            className={`${styles.flowNodeStatus} ${
              configured ? styles.configured : styles.unconfigured
            }`}
          >
            {configured ? '已配置' : '未配置'}
          </span>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
        />
      </div>

      {/* + 号按钮 */}
      {showAddButton && (
        <div className={styles.flowAddRow}>
          <AddButton afterNodeId={id} />
        </div>
      )}
    </div>
  );
}
