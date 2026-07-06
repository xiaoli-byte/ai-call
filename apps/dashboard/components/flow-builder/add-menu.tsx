'use client';

import type { FlowNodeType } from '@ai-call/shared';
import { useFlowStore } from './store/flow-store';
import {
  ADDABLE_NODE_TYPES,
  NODE_META,
  RECOMMENDATIONS,
} from './types/flow';
import { flowNodeIconClass } from './accent-classes';
import styles from './flow-builder.module.scss';

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
    <div className={styles.flowAddMenu} role="menu">
      {recommendedTypes.length > 0 && (
        <>
          <div className={styles.flowAddMenuGroupLabel}>推荐</div>
          {recommendedTypes.map((type) => (
            <MenuItem key={type} type={type} onSelect={onSelect} />
          ))}
          {otherTypes.length > 0 && <div className={styles.flowAddMenuDivider} />}
        </>
      )}
      {otherTypes.length > 0 && (
        <>
          <div className={styles.flowAddMenuGroupLabel}>其他</div>
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
      className={styles.flowAddMenuItem}
      role="menuitem"
    >
      <div className={`${styles.flowAddMenuItemIcon} ${flowNodeIconClass[meta.accent]}`}>
        <Icon />
      </div>
      <div className={styles.flowAddMenuItemContent}>
        <div className={styles.flowAddMenuItemTitle}>{meta.title}</div>
        <div className={styles.flowAddMenuItemDesc}>{meta.description}</div>
      </div>
    </button>
  );
}
