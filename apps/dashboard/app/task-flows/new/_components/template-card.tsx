import { ArrowRight, LoaderCircle, Square, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlowNodeType, TaskFlowTemplate } from '@ai-call/shared';

import styles from './template-card.module.scss';

const NODE_COLORS: Record<string, string> = {
  start: '#2563eb',
  dialog: '#10b981',
  decision: '#f59e0b',
  action: '#8b5cf6',
  end: '#ef4444',
};

type TemplateCardProps = {
  template: TaskFlowTemplate;
  disabled: boolean;
  loading: boolean;
  dimmed: boolean;
  subtitle: string;
  emptyLabel: string;
  loadingLabel: string;
  ctaLabel: string;
  onSelect: () => void;
};

function TemplatePreview({ template, emptyLabel }: { template: TaskFlowTemplate; emptyLabel: string }) {
  const nodes = template.nodes;
  if (nodes.length === 0) {
    return (
      <div className={styles.previewEmpty}>
        <Square size={20} strokeWidth={1.5} />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className={styles.preview}>
      {nodes.map((node, index) => (
        <div key={node.id} className={styles.previewStep}>
          <div
            className={styles.previewNode}
            style={{ background: NODE_COLORS[node.type as FlowNodeType] }}
            title={node.type}
          />
          {index < nodes.length - 1 && <div className={styles.previewLine} />}
        </div>
      ))}
    </div>
  );
}

export function TemplateCard({
  template,
  disabled,
  loading,
  dimmed,
  subtitle,
  emptyLabel,
  loadingLabel,
  ctaLabel,
  onSelect,
}: TemplateCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(styles.card, dimmed && styles.dimmed)}
    >
      <div className={styles.header}>
        <div className={styles.icon}>
          <Workflow size={18} strokeWidth={1.75} />
        </div>
        <div>
          <div className={styles.title}>{template.name}</div>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
      </div>

      <TemplatePreview template={template} emptyLabel={emptyLabel} />

      <p className={styles.description}>{template.description}</p>

      <div className={styles.footer}>
        <div className="tag-list">
          <span className="badge badge-info">{template.nodes.length} 节点</span>
          <span className="badge badge-neutral">{template.edges.length} 连线</span>
        </div>
        <span className={cn(styles.cta, loading && styles.ctaLoading)}>
          {loading ? (
            <>
              <LoaderCircle size={13} className={styles.spin} />
              {loadingLabel}
            </>
          ) : (
            <>
              {ctaLabel}
              <ArrowRight size={12} />
            </>
          )}
        </span>
      </div>
    </button>
  );
}
