'use client';

import Link from 'next/link';
import { useReactFlow } from '@xyflow/react';
import type { FlowStatus } from '@ai-call/shared';
import { useFlowStore } from './store/flow-store';
import type { SaveStatus } from './hooks/use-flow-storage';
import styles from './flow-builder.module.scss';

interface ToolbarProps {
  flowName: string;
  flowVersion?: number;
  flowStatus?: FlowStatus;
  onSave: () => void;
  saveStatus: SaveStatus;
  onPublish?: () => void;
  onTest?: () => void;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
};

function IconBtn({
  onClick,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={styles.flowIconBtn}
    >
      {children}
    </button>
  );
}

export function Toolbar({ flowName, flowVersion, flowStatus, onSave, saveStatus, onPublish, onTest }: ToolbarProps) {
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);
  const organizeLayout = useFlowStore((s) => s.organizeLayout);
  const nodeCount = useFlowStore((s) => s.nodes.length);
  const canUndo = useFlowStore((s) => s.canUndo());
  const canRedo = useFlowStore((s) => s.canRedo());
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const published = flowStatus === 'published';

  function handleOrganizeLayout() {
    organizeLayout();
    requestAnimationFrame(() => {
      fitView({ duration: 240, padding: 0.18 });
    });
  }

  return (
    <div className={styles.flowEditorHeader}>
      <div className={styles.flowEditorHeaderLeft}>
        <Link href="/task-flows" className={styles.flowEditorBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          返回列表
        </Link>
        <span className={styles.flowEditorDivider} />
        <span className={styles.flowEditorTitle}>{flowName}</span>
      </div>

      <div className={styles.flowEditorHeaderRight}>
        {flowVersion !== undefined && (
          <span className="badge badge-neutral text-mono" style={{ fontSize: '11px' }}>
            v{flowVersion}
          </span>
        )}
        {flowStatus && (
          <span className={`badge ${flowStatus === 'published' ? 'badge-success' : 'badge-neutral'}`}>
            {flowStatus === 'published' ? '已发布' : '草稿'}
          </span>
        )}
        {saveStatus !== 'idle' && (
          <span className={`${styles.flowEditorStatus} ${styles[saveStatus]}`}>
            <span className={styles.statusDot} />
            {STATUS_TEXT[saveStatus]}
          </span>
        )}
        <IconBtn onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
          </svg>
        </IconBtn>
        <IconBtn onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
          </svg>
        </IconBtn>

        <span className={styles.flowEditorDivider} />

        <IconBtn onClick={() => zoomIn({ duration: 200 })} title="放大">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </IconBtn>
        <IconBtn onClick={() => zoomOut({ duration: 200 })} title="缩小">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </IconBtn>
        <IconBtn onClick={() => fitView({ duration: 200 })} title="适应画布">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          </svg>
        </IconBtn>
        <IconBtn onClick={handleOrganizeLayout} disabled={nodeCount === 0} title="整理流程">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18" />
            <rect x="6" y="4" width="12" height="4" rx="1" />
            <rect x="6" y="10" width="12" height="4" rx="1" />
            <rect x="6" y="16" width="12" height="4" rx="1" />
          </svg>
        </IconBtn>

        <span className={styles.flowEditorDivider} />

        <button type="button" onClick={onSave} className={styles.flowSaveBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          保存
        </button>
        {onTest && (
          <button
            type="button"
            onClick={onTest}
            className="btn btn-secondary btn-sm"
            title="测试完整流程"
          >
            测试
          </button>
        )}
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            className="btn btn-sm"
            disabled={published}
            title={published ? '当前流程已发布，编辑后会回到草稿' : '发布流程'}
          >
            {published ? '已发布' : '发布'}
          </button>
        )}
      </div>
    </div>
  );
}
