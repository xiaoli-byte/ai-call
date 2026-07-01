'use client';

import type { FlowNodeType } from '@ai-call/shared';
import { useFlowStore } from './store/flow-store';
import {
  ADDABLE_NODE_TYPES,
  NODE_META,
  RECOMMENDATIONS,
} from './types/flow';

interface AddMenuProps {
  afterNodeId: string;
  onSelect: (type: FlowNodeType) => void;
  onClose: () => void;
}

/**
 * + 号弹出菜单 — 浅色 SaaS 风格
 *
 * 按上游节点类型智能推荐，分"推荐"/"其他"两组。
 * 不显示 Start（整个流程只能有一个）。
 */
export function AddMenu({ afterNodeId, onSelect }: AddMenuProps) {
  const nodes = useFlowStore((s) => s.nodes);
  const afterNode = nodes.find((n) => n.id === afterNodeId);
  const recommended: FlowNodeType[] = afterNode
    ? RECOMMENDATIONS[afterNode.type]
    : [];

  const recommendedTypes = ADDABLE_NODE_TYPES.filter((t) =>
    recommended.includes(t),
  );
  const otherTypes = ADDABLE_NODE_TYPES.filter(
    (t) => !recommended.includes(t),
  );

  return (
    <div className="flow-add-menu" role="menu">
      {recommendedTypes.length > 0 && (
        <>
          <div className="flow-add-menu-group-label">推荐</div>
          {recommendedTypes.map((type) => (
            <MenuItem key={type} type={type} onSelect={onSelect} />
          ))}
          {otherTypes.length > 0 && <div className="flow-add-menu-divider" />}
        </>
      )}
      {otherTypes.length > 0 && (
        <>
          <div className="flow-add-menu-group-label">其他</div>
          {otherTypes.map((type) => (
            <MenuItem key={type} type={type} onSelect={onSelect} />
          ))}
        </>
      )}
    </div>
  );
}

function MenuItem({
  type,
  onSelect,
}: {
  type: FlowNodeType;
  onSelect: (t: FlowNodeType) => void;
}) {
  const meta = NODE_META[type];
  const Icon = meta.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(type)}
      className="flow-add-menu-item"
      role="menuitem"
    >
      <div className={`flow-add-menu-item-icon flow-node-icon-${meta.accent}`}>
        <Icon />
      </div>
      <div className="flow-add-menu-item-content">
        <div className="flow-add-menu-item-title">{meta.title}</div>
        <div className="flow-add-menu-item-desc">{meta.description}</div>
      </div>
    </button>
  );
}