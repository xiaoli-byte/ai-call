import type { NodeMeta } from './types/flow';

import styles from './flow-builder.module.scss';

type NodeAccent = NodeMeta['accent'];

export const flowNodeAccentClass: Record<NodeAccent, string> = {
  primary: styles.flowNodeAccentPrimary,
  success: styles.flowNodeAccentSuccess,
  warning: styles.flowNodeAccentWarning,
  violet: styles.flowNodeAccentViolet,
  danger: styles.flowNodeAccentDanger,
};

export const flowNodeIconClass: Record<NodeAccent, string> = {
  primary: styles.flowNodeIconPrimary,
  success: styles.flowNodeIconSuccess,
  warning: styles.flowNodeIconWarning,
  violet: styles.flowNodeIconViolet,
  danger: styles.flowNodeIconDanger,
};
